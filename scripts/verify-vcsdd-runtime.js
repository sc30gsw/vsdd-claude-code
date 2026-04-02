#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateDocument } = require('./lib/vcsdd-schema');
const { resolveInstallPlan } = require('./install/resolve-install-plan');
const {
  initFeature,
  transitionPhase,
  recordGate,
  computeSprintContractReviewDigest,
} = require('./lib/vcsdd-state');
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vcsdd-runtime-verify-'));
}

function listBundledSkillDirs(options = {}) {
  const { includeLanguage = true } = options;
  const skillsRoot = path.join(__dirname, '..', 'skills');
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => includeLanguage || !name.startsWith('vcsdd-language-'))
    .map((name) => `skills/${name}/`)
    .sort();
}

function createPassingVerdict(feature, evidenceLocation, options = {}) {
  const {
    iteration = 1,
    convergenceSignals = {
      findingCount: 0,
      previousFindingCount: 1,
      allCriteriaEvaluated: true,
      duplicateFindings: [],
    },
    reviewContext,
  } = options;

  const verdict = {
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
    iteration,
    convergenceSignals,
  };

  if (reviewContext) {
    verdict.reviewContext = reviewContext;
  }

  return verdict;
}

// ── Schema validation: valid and invalid finding/grading payloads ──
{
  const validFinding = {
    findingId: 'FIND-001',
    dimension: 'spec_fidelity',
    category: 'requirement_mismatch',
    severity: 'critical',
    description: 'REQ-001 is not covered by any implementation path in the reviewed artifact set.',
    evidence: {
      filePath: 'src/parser.ts',
      lineRange: '10-20',
    },
    routeToPhase: '2b',
  };
  assert(validateDocument('finding', validFinding).valid, 'valid finding should pass schema validation');
  assert(
    validateDocument('finding', {
      findingId: 'FIND-002',
      dimension: 'verification_readiness',
      category: 'verification_tool_mismatch',
      severity: 'high',
      description: 'The selected proof tool cannot verify the unbounded liveness property claimed by PROP-003.',
      evidence: {
        filePath: 'specs/verification-architecture.md',
        lineRange: '12-22',
      },
      routeToPhase: '1b',
    }).valid,
    'verification_tool_mismatch findings should route cleanly to phase 1b'
  );

  const invalidFinding = {
    ...validFinding,
    routeToPhase: '9',
  };
  assert(!validateDocument('finding', invalidFinding).valid, 'invalid finding route should fail schema validation');
  assert(
    !validateDocument('finding', {
      ...validFinding,
      category: undefined,
    }).valid,
    'finding without category should fail schema validation'
  );
  assert(
    !validateDocument('finding', {
      ...validFinding,
      evidence: { filePath: 'src/parser.ts' },
    }).valid,
    'finding without lineRange should fail schema validation'
  );
  assert(
    !validateDocument('finding', {
      ...validFinding,
      dimension: 'structural_integrity',
    }).valid,
    'finding category/dimension mismatch should fail semantic validation'
  );

  const validVerdict = createPassingVerdict('runtime-check', 'src/parser.ts');
  assert(validateDocument('grading', validVerdict).valid, 'valid grading verdict should pass schema validation');
  const validContractReviewVerdict = createPassingVerdict('runtime-check', 'contracts/sprint-1.md', {
    reviewContext: {
      reviewType: 'contract',
      contractPath: 'contracts/sprint-1.md',
      contractDigest: 'a'.repeat(64),
    },
  });
  assert(
    validateDocument('grading', validContractReviewVerdict).valid,
    'contract review verdict with reviewContext should pass schema validation'
  );

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
  assert(
    !validateDocument('grading', {
      ...validContractReviewVerdict,
      reviewContext: {
        reviewType: 'contract',
        contractPath: 'contracts/sprint-1.md',
      },
    }).valid,
    'contract review verdict must include contractDigest'
  );
}

// ── Feature names are validated before any state is written ──
assertThrows(
  () => initFeature('Bad_Name', 'lean'),
  'featureName must be kebab-case'
);

// ── Contract validation and contract review are enforced before strict-mode phase 3 ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'schema-feature';
  initFeature(feat, 'strict');
  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  recordGate(feat, '1c', 'PASS', 'human', { approvedBasedOn: 'adversary' });
  transitionPhase(feat, '2a');
  writeFile(root, `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`, 'new-feature-tests: FAIL\nregression-baseline: PASS\n');
  transitionPhase(feat, '2b');
  writeFile(root, `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`, 'target-feature-tests: PASS\nregression-baseline: PASS\n');
  transitionPhase(feat, '2c');
  writeFile(root, `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`, 'target-feature-tests: PASS\nregression-baseline: PASS\n');
  writeFile(
    root,
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
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

{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'contract-review-feature';
  initFeature(feat, 'strict');
  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  recordGate(feat, '1c', 'PASS', 'human', { approvedBasedOn: 'adversary' });
  transitionPhase(feat, '2a');
  writeFile(root, `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`, 'new-feature-tests: FAIL\nregression-baseline: PASS\n');
  transitionPhase(feat, '2b');
  writeFile(root, `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`, 'target-feature-tests: PASS\nregression-baseline: PASS\n');
  transitionPhase(feat, '2c');
  writeFile(root, `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`, 'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n');
  writeFile(
    root,
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
    [
      '---',
      'sprintNumber: 1',
      'feature: contract-review-feature',
      'status: approved',
      'criteria:',
      '  - id: CRIT-001',
      '    dimension: spec_fidelity',
      '    description: Requirements map cleanly to reviewed artifacts',
      '    weight: 0.30',
      '    passThreshold: Every REQ-XXX can be evaluated from spec, tests, and source',
      '---',
      '',
      '# Contract',
      '',
    ].join('\n')
  );
  const contractContent = fs.readFileSync(
    path.join(root, `.vcsdd/features/${feat}/contracts/sprint-1.md`),
    'utf8'
  );
  const reviewContext = {
    reviewType: 'contract',
    contractPath: 'contracts/sprint-1.md',
    contractDigest: computeSprintContractReviewDigest(contractContent),
  };

  assertThrows(
    () => transitionPhase(feat, '3'),
    'Contract review PASS required'
  );

  writeFile(
    root,
    `.vcsdd/features/${feat}/reviews/contracts/sprint-1/output/verdict.json`,
    JSON.stringify(
      createPassingVerdict(feat, `.vcsdd/features/${feat}/contracts/sprint-1.md`, {
        reviewContext,
      }),
      null,
      2
    ) + '\n'
  );
  transitionPhase(feat, '3');
}

// ── Install plan resolution follows manifests and dependencies ──
{
  const minimal = resolveInstallPlan('minimal', null);
  assert(minimal.modules.includes('vcsdd-docs'), 'minimal profile should include docs module');
  assert(minimal.paths.includes('schemas/'), 'minimal profile should include schemas path');
  assert(!minimal.modules.includes('vcsdd-hooks'), 'minimal profile should not include hooks');

  const standard = resolveInstallPlan('standard', null);
  assert(standard.modules.includes('vcsdd-contexts'), 'standard profile should include contexts');
  assert(standard.paths.includes('contexts/'), 'standard profile should install context files');
  const expectedStandardSkills = listBundledSkillDirs({ includeLanguage: false });
  for (const skillPath of expectedStandardSkills) {
    assert(
      standard.paths.includes(skillPath),
      `standard profile should install bundled skill path ${skillPath}`
    );
  }

  const strictTs = resolveInstallPlan('strict', 'typescript');
  assert(strictTs.modules.includes('vcsdd-hooks'), 'strict profile should include hooks');
  assert(strictTs.modules.includes('vcsdd-contexts'), 'strict profile should include contexts');
  assert(strictTs.modules.includes('vcsdd-language-typescript'), 'typescript language module should be resolved');
  assert(strictTs.paths.includes('skills/vcsdd-language-typescript/'), 'typescript skill path should be installed');
  assert(strictTs.paths.includes('VCSDD.md'), 'docs should be installed from manifests');
  for (const skillPath of expectedStandardSkills) {
    assert(
      strictTs.paths.includes(skillPath),
      `strict profile should install bundled skill path ${skillPath}`
    );
  }
}

// eslint-disable-next-line no-console
console.log('verify-vcsdd-runtime: OK');
