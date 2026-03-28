#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateDocument } = require('./lib/vsdd-schema');
const { resolveInstallPlan } = require('./install/resolve-install-plan');
const { initFeature, transitionPhase, recordGate } = require('./lib/vsdd-state');
const CANONICAL_DIMENSIONS = [
  'spec_fidelity',
  'edge_case_coverage',
  'implementation_correctness',
  'structural_integrity',
  'verification_readiness',
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(fn, expectedSubstring) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }

  if (!thrown) {
    throw new Error(`Expected function to throw: ${expectedSubstring}`);
  }

  if (expectedSubstring && !String(thrown.message).includes(expectedSubstring)) {
    throw new Error(`Expected error to include "${expectedSubstring}", got "${thrown.message}"`);
  }
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vsdd-runtime-verify-'));
}

function createPassingVerdict(feature, evidenceLocation) {
  return {
    sprintNumber: 1,
    feature,
    dimensions: CANONICAL_DIMENSIONS.map((name) => ({
      name,
      verdict: 'PASS',
      findings: [],
      evidence: [
        {
          type: 'file',
          location: evidenceLocation,
          description: `Reviewed evidence for ${name}`,
        },
      ],
    })),
    overallVerdict: 'PASS',
    timestamp: new Date().toISOString(),
    convergenceSignals: {
      findingCount: 0,
      previousFindingCount: 1,
      allCriteriaEvaluated: true,
      duplicateFindings: [],
    },
  };
}

// ── Schema validation: valid and invalid finding/grading payloads ──
{
  const validFinding = {
    findingId: 'FIND-001',
    dimension: 'spec_fidelity',
    severity: 'critical',
    description: 'REQ-001 is not covered by any implementation path in the reviewed artifact set.',
    evidence: {
      filePath: 'src/parser.ts',
      lineRange: '10-20',
    },
    routeToPhase: '2b',
  };
  assert(validateDocument('finding', validFinding).valid, 'valid finding should pass schema validation');

  const invalidFinding = {
    ...validFinding,
    routeToPhase: '9',
  };
  assert(!validateDocument('finding', invalidFinding).valid, 'invalid finding route should fail schema validation');
  assert(
    !validateDocument('finding', {
      ...validFinding,
      evidence: { filePath: 'src/parser.ts' },
    }).valid,
    'finding without lineRange should fail schema validation'
  );

  const validVerdict = createPassingVerdict('runtime-check', 'src/parser.ts');
  assert(validateDocument('grading', validVerdict).valid, 'valid grading verdict should pass schema validation');

  const invalidVerdict = {
    ...validVerdict,
    dimensions: [
      { name: 'spec_fidelity', verdict: 'MAYBE', findings: [], evidence: [] },
    ],
  };
  assert(!validateDocument('grading', invalidVerdict).valid, 'invalid verdict enum should fail schema validation');
  assert(
    !validateDocument('grading', {
      ...validVerdict,
      dimensions: validVerdict.dimensions.slice(0, 4),
    }).valid,
    'grading verdict must include all five canonical dimensions'
  );
  assert(
    !validateDocument('grading', {
      ...validVerdict,
      overallVerdict: 'FAIL',
    }).valid,
    'overall verdict must match per-dimension verdicts'
  );
}

// ── Feature names are validated before any state is written ──
assertThrows(
  () => initFeature('Bad_Name', 'lean'),
  'featureName must be kebab-case'
);

// ── Contract validation is enforced before strict-mode phase 3 ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'schema-feature';
  initFeature(feat, 'strict');
  transitionPhase(feat, '1a');
  writeFile(root, `.vsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  recordGate(feat, '1c', 'PASS', 'human', { approvedBasedOn: 'adversary' });
  transitionPhase(feat, '2a');
  writeFile(root, `.vsdd/features/${feat}/evidence/sprint-1-red-phase.log`, 'new-feature-tests: FAIL\nregression-baseline: PASS\n');
  transitionPhase(feat, '2b');
  writeFile(root, `.vsdd/features/${feat}/evidence/sprint-1-green-phase.log`, 'target-feature-tests: PASS\nregression-baseline: PASS\n');
  transitionPhase(feat, '2c');
  writeFile(root, `.vsdd/features/${feat}/evidence/sprint-1-green-phase.log`, 'target-feature-tests: PASS\nregression-baseline: PASS\n');
  writeFile(
    root,
    `.vsdd/features/${feat}/contracts/sprint-1.md`,
    [
      '---',
      'sprintNumber: 1',
      'feature: schema-feature',
      'status: approved',
      'criteria:',
      '  - id: CRIT-001',
      '    dimension: spec_fidelity',
      '    description: Too short',
      '    passThreshold: Present but missing weight',
      '---',
      '',
      '# Invalid Contract',
      '',
    ].join('\n')
  );

  assertThrows(
    () => transitionPhase(feat, '3'),
    'Invalid sprint contract'
  );
}

// ── Install plan resolution follows manifests and dependencies ──
{
  const minimal = resolveInstallPlan('minimal', null);
  assert(minimal.modules.includes('vsdd-docs'), 'minimal profile should include docs module');
  assert(minimal.paths.includes('schemas/'), 'minimal profile should include schemas path');
  assert(!minimal.modules.includes('vsdd-hooks'), 'minimal profile should not include hooks');

  const standard = resolveInstallPlan('standard', null);
  assert(standard.modules.includes('vsdd-contexts'), 'standard profile should include contexts');
  assert(standard.paths.includes('contexts/'), 'standard profile should install context files');

  const strictTs = resolveInstallPlan('strict', 'typescript');
  assert(strictTs.modules.includes('vsdd-hooks'), 'strict profile should include hooks');
  assert(strictTs.modules.includes('vsdd-contexts'), 'strict profile should include contexts');
  assert(strictTs.modules.includes('vsdd-language-typescript'), 'typescript language module should be resolved');
  assert(strictTs.paths.includes('skills/vsdd-language-typescript/'), 'typescript skill path should be installed');
  assert(strictTs.paths.includes('VSDD.md'), 'docs should be installed from manifests');
}

// eslint-disable-next-line no-console
console.log('verify-vsdd-runtime: OK');
