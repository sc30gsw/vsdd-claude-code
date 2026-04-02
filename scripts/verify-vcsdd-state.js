#!/usr/bin/env node
'use strict';

/**
 * Smoke-test the state machine and gate enforcement.
 * Run from repo root: node scripts/verify-vcsdd-state.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const vcsdd = require('./lib/vcsdd-state');
const traceability = require('./lib/vcsdd-traceability');
const {
  initFeature,
  readState,
  transitionPhase,
  routeFeedback,
  recordGate,
  writeState,
  getLanguageForFeature,
  getActiveFeaturePath,
  getIterationLimit,
  computeSprintContractReviewDigest,
} = vcsdd;

const gateHookPath = path.join(__dirname, 'hooks', 'vcsdd-gate-check.js');
const coherenceRefreshHookPath = path.join(__dirname, 'hooks', 'vcsdd-coherence-refresh.js');
const CANONICAL_DIMENSIONS = [
  'spec_fidelity',
  'edge_case_coverage',
  'implementation_correctness',
  'structural_integrity',
  'verification_readiness',
];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vcsdd-verify-'));
}

function writeFile(absRoot, rel, content = 'ok\n') {
  const p = path.join(absRoot, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function readHistoryEvents(absRoot) {
  const historyPath = path.join(absRoot, '.vcsdd', 'history.jsonl');
  if (!fs.existsSync(historyPath)) return [];
  return fs.readFileSync(historyPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function writeFormalHardeningArtifacts(absRoot, featureName, overrides = {}) {
  writeFile(
    absRoot,
    `.vcsdd/features/${featureName}/verification/verification-report.md`,
    overrides.verificationReport || [
      '# Verification Report',
      '',
      '## Proof Obligations',
      '',
      '| ID | Tier | Required | Status | Tool | Artifact |',
      '|----|------|----------|--------|------|----------|',
      '| PROP-001 | 1 | true | proved | harness-check | verification/proof-harnesses/example.txt |',
      '',
      '## Summary',
      '',
      '- Required obligations: 1',
      '- Proved: 1',
      '- Failed: 0',
    ].join('\n') + '\n'
  );
  writeFile(
    absRoot,
    `.vcsdd/features/${featureName}/verification/security-report.md`,
    overrides.securityReport || [
      '# Security Hardening Report',
      '',
      '## Tooling',
      '',
      '- Semgrep: not_applicable',
      '- Wycheproof: not_applicable',
      '',
      '## Summary',
      '',
      '- Overall status: PASS',
    ].join('\n') + '\n'
  );
  writeFile(
    absRoot,
    `.vcsdd/features/${featureName}/verification/purity-audit.md`,
    overrides.purityAudit || [
      '# Purity Boundary Audit',
      '',
      '## Declared Boundaries',
      '',
      '- Pure core: parser core',
      '- Effectful shell: CLI adapter',
      '',
      '## Observed Boundaries',
      '',
      '- No drift detected between declared and observed boundaries.',
      '',
      '## Summary',
      '',
      '- Overall status: PASS',
    ].join('\n') + '\n'
  );
  writeFile(
    absRoot,
    `.vcsdd/features/${featureName}/verification/security-results/tooling.log`,
    overrides.securityResults || 'semgrep: not_applicable\nwycheproof: not_applicable\n'
  );
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertThrows(fn, expectedSubstring) {
  let thrown = null;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }

  if (!thrown) {
    throw new Error(`Expected function to throw: ${expectedSubstring}`);
  }

  if (expectedSubstring && !String(thrown.message).includes(expectedSubstring)) {
    throw new Error(`Expected error to include "${expectedSubstring}", got "${thrown.message}"`);
  }
}

function runHook(root, hookPath, payload, extraEnv = {}) {
  return spawnSync('node', [hookPath], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
}

function runGateHook(root, payload) {
  return runHook(root, gateHookPath, payload);
}

function runCoherenceRefreshHook(root, payload) {
  return runHook(root, coherenceRefreshHookPath, payload, {
    VCSDD_HOOK_PROFILE: 'standard',
  });
}

function createPassingVerdict(
  feature,
  sprintNumber,
  iteration,
  evidenceLocation,
  convergenceSignals,
  reviewContext
) {
  const verdict = {
    sprintNumber,
    feature,
    overallVerdict: 'PASS',
    timestamp: new Date().toISOString(),
    iteration,
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
    convergenceSignals,
  };

  if (reviewContext) {
    verdict.reviewContext = reviewContext;
  }

  return verdict;
}

function createStrictConvergenceSignals(criteriaIds, overrides = {}) {
  return {
    findingCount: 0,
    previousFindingCount: 1,
    allCriteriaEvaluated: true,
    evaluatedCriteria: criteriaIds,
    duplicateFindings: [],
    ...overrides,
  };
}

function createContractReviewContext(root, feature, sprintNumber = 1) {
  const contractRelativePath = `contracts/sprint-${sprintNumber}.md`;
  const contractAbsolutePath = path.join(
    root,
    `.vcsdd/features/${feature}`,
    contractRelativePath
  );
  const contractContent = fs.readFileSync(contractAbsolutePath, 'utf8');

  return {
    reviewType: 'contract',
    contractPath: contractRelativePath,
    contractDigest: computeSprintContractReviewDigest(contractContent),
  };
}

function writePassingReviewVerdict(root, feature, reviewScope, evidenceLocation, options = {}) {
  const {
    sprintNumber = 1,
    iteration = 1,
    convergenceSignals = {
      findingCount: 0,
      previousFindingCount: 1,
      allCriteriaEvaluated: true,
      duplicateFindings: [],
    },
    reviewContext,
  } = options;

  writeFile(
    root,
    `.vcsdd/features/${feature}/reviews/${reviewScope}/output/verdict.json`,
    JSON.stringify(
      createPassingVerdict(
        feature,
        sprintNumber,
        iteration,
        evidenceLocation,
        convergenceSignals,
        reviewContext
      ),
      null,
      2
    ) + '\n'
  );
}

function writeFailingReviewVerdict(root, feature, reviewScope, evidenceLocation, options = {}) {
  const {
    sprintNumber = 1,
    iteration = 1,
    findingIds = ['FIND-001'],
    reviewContext,
  } = options;

  const verdict = {
    sprintNumber,
    feature,
    overallVerdict: 'FAIL',
    timestamp: new Date().toISOString(),
    iteration,
    dimensions: CANONICAL_DIMENSIONS.map((name, index) => ({
      name,
      verdict: index === 0 ? 'FAIL' : 'PASS',
      findings: index === 0 ? findingIds : [],
      evidence: [
        {
          type: 'file',
          location: evidenceLocation,
          description: `Reviewed evidence for ${name}`,
        },
      ],
    })),
  };

  if (reviewContext) {
    verdict.reviewContext = reviewContext;
  }

  writeFile(
    root,
    `.vcsdd/features/${feature}/reviews/${reviewScope}/output/verdict.json`,
    JSON.stringify(verdict, null, 2) + '\n'
  );
}

// ── Bash gate: block path-based writes even without redirection ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'gate-feature';
  initFeature(feat, 'strict');
  transitionPhase(feat, '1a');

  const blocked = runGateHook(root, {
    tool_name: 'Bash',
    tool_input: { command: 'cp foo src/x.ts' },
  });
  assert(blocked.status === 2, 'cp into src should be blocked during phase 1a');

  const allowed = runGateHook(root, {
    tool_name: 'Bash',
    tool_input: { command: 'cat src/x.ts' },
  });
  assert(allowed.status === 0, 'read-only cat should remain allowed during phase 1a');

  const blockedTsx = runGateHook(root, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(root, 'src/App.tsx') },
  });
  assert(blockedTsx.status === 2, 'tsx source should be blocked during phase 1a');

  const blockedHeader = runGateHook(root, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(root, 'src/parser.hpp') },
  });
  assert(blockedHeader.status === 2, 'C++ headers should be blocked during phase 1a');
}

// ── Control files: direct edits must be blocked ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'control-feature';
  initFeature(feat, 'strict');

  const blocked = runGateHook(root, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(root, `.vcsdd/features/${feat}/state.json`) },
  });
  assert(blocked.status === 2, 'direct state.json edits should be blocked in every phase');
}

// ── Spec review gate: tests must still be blocked before phase 2a ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'spec-review-feature';
  initFeature(feat, 'lean');
  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');

  const blocked = runGateHook(root, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(root, 'tests/example.test.ts') },
  });
  assert(blocked.status === 2, 'tests should stay blocked during phase 1c');
}

// ── Coherence gate: frontmatter activates validation even before coherence.json exists ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'coherence-frontmatter-gate-feature';
  initFeature(feat, 'lean');
  transitionPhase(feat, '1a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/specs/behavioral-spec.md`,
    [
      '---',
      'coherence:',
      '  node_id: req:coherence-gate',
      '  depends_on:',
      '    - id: req:missing-upstream',
      '---',
      '',
      '# Behavioral',
      '',
    ].join('\n')
  );
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');

  assertThrows(
    () => transitionPhase(feat, '2a'),
    'Coherence validation failed'
  );
}

// ── Coherence gate: valid frontmatter auto-builds coherence.json at phase 2a ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'coherence-auto-build-feature';
  initFeature(feat, 'lean');
  transitionPhase(feat, '1a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/specs/behavioral-spec.md`,
    [
      '---',
      'coherence:',
      '  node_id: req:coherence-auto-build',
      '---',
      '',
      '# Behavioral',
      '',
    ].join('\n')
  );
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');

  assert(
    fs.existsSync(path.join(root, `.vcsdd/features/${feat}/coherence.json`)),
    'coherence.json should be rebuilt automatically when coherence frontmatter exists'
  );
}

// ── Coherence gate: corrupted coherence.json is backed up and rebuilt from frontmatter ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'coherence-corrupt-recovery-feature';
  initFeature(feat, 'lean');
  transitionPhase(feat, '1a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/specs/behavioral-spec.md`,
    [
      '---',
      'coherence:',
      '  node_id: req:coherence-recover',
      '---',
      '',
      '# Behavioral',
      '',
    ].join('\n')
  );
  writeFile(root, `.vcsdd/features/${feat}/coherence.json`, '{broken json');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');

  const coherencePath = path.join(root, `.vcsdd/features/${feat}/coherence.json`);
  const rebuilt = JSON.parse(fs.readFileSync(coherencePath, 'utf8'));
  const historyEvents = fs.readFileSync(vcsdd.getHistoryPath(), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((event) => event.featureName === feat);

  assert(fs.existsSync(`${coherencePath}.bak`), 'corrupted coherence.json should be backed up during recovery');
  assert(rebuilt.nodes['req:coherence-recover'], 'recovered coherence graph should be rebuilt from current frontmatter');
  assert(
    historyEvents.some((event) => event.event === 'coherence_recovered' && event.phase === '2a'),
    'phase 2a recovery should be recorded in history.jsonl'
  );
}

// ── Coherence gate: invalid node_id blocks phase 2a ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'coherence-invalid-nodeid-feature';
  initFeature(feat, 'lean');
  transitionPhase(feat, '1a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/specs/behavioral-spec.md`,
    [
      '---',
      'coherence:',
      '  node_id: INVALID_NO_PREFIX',
      '---',
      '',
      '# Behavioral',
      '',
    ].join('\n')
  );
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');

  assertThrows(
    () => transitionPhase(feat, '2a'),
    'invalid node_id'
  );
}

// ── Coherence gate: malformed frontmatter blocks phase 2a ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'coherence-invalid-frontmatter-feature';
  initFeature(feat, 'lean');
  transitionPhase(feat, '1a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/specs/behavioral-spec.md`,
    [
      '---',
      'coherence:',
      '  node_id "req:broken"',
      '---',
      '',
      '# Behavioral',
      '',
    ].join('\n')
  );
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');

  assertThrows(
    () => transitionPhase(feat, '2a'),
    'invalid frontmatter'
  );
}

// ── Coherence refresh hook: spec edits rebuild the graph before later phases rely on it ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'coherence-refresh-hook-feature';
  initFeature(feat, 'lean');
  transitionPhase(feat, '1a');

  const specPath = path.join(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`);
  writeFile(
    root,
    `.vcsdd/features/${feat}/specs/behavioral-spec.md`,
    [
      '---',
      'coherence:',
      '  node_id: req:hook-refresh',
      '---',
      '',
      '# Behavioral',
      '',
    ].join('\n')
  );

  const refreshResult = runCoherenceRefreshHook(root, {
    tool_name: 'Write',
    tool_input: { file_path: specPath },
  });
  assert(refreshResult.status === 0, 'coherence refresh hook should not block spec edits');

  const coherencePath = path.join(root, `.vcsdd/features/${feat}/coherence.json`);
  assert(fs.existsSync(coherencePath), 'coherence refresh hook should rebuild coherence.json');
  const coherence = JSON.parse(fs.readFileSync(coherencePath, 'utf8'));
  assert(coherence.nodes['req:hook-refresh'], 'rebuilt coherence graph should include the edited spec node');
}

// ── Lean: full 6-phase path with lighter gates (no human approval, selective proofs) ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'lean-feature';
  initFeature(feat, 'lean', 'typescript');
  assert(getLanguageForFeature(feat) === 'typescript', 'language should be typescript');
  assert(fs.existsSync(getActiveFeaturePath()), 'active-feature.txt should exist after init');
  assert(fs.readFileSync(getActiveFeaturePath(), 'utf8').trim() === feat, 'active-feature.txt should match feature');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  writeFile(
    root,
    `.vcsdd/features/${feat}/reviews/sprint-1/output/verdict.json`,
    JSON.stringify(
      createPassingVerdict(
        feat,
        1,
        1,
        `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
        {
          findingCount: 0,
          previousFindingCount: 1,
          allCriteriaEvaluated: true,
          duplicateFindings: [],
        }
      ),
      null,
      2
    ) + '\n'
  );
  transitionPhase(feat, '5');
  writeFormalHardeningArtifacts(root, feat, {
    verificationReport: [
      '# Verification Report',
      '',
      '## Proof Obligations',
      '',
      'No required proof obligations.',
      '',
      '## Summary',
      '',
      '- Required obligations: 0',
      '- Proved: 0',
      '- Failed: 0',
    ].join('\n') + '\n',
  });
  transitionPhase(feat, '6');
  transitionPhase(feat, 'complete');

  const st = readState(feat);
  assert(st.currentPhase === 'complete', 'lean should end at complete');
  assert(
    fs.existsSync(path.join(root, `.vcsdd/features/${feat}/verification/security-results`)),
    'initFeature should create verification/security-results'
  );
}

// ── Freshness: pre-written green evidence must not satisfy phase 2c ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'freshness-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  const staleGreenLog = path.join(root, `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`);
  const staleDate = new Date(Date.now() - 10000);
  fs.utimesSync(staleGreenLog, staleDate, staleDate);
  transitionPhase(feat, '2b');

  assertThrows(
    () => transitionPhase(feat, '2c'),
    'Green phase evidence (sprint-1-green-phase.log) must be recorded after entering phase 2b'
  );
}

// ── Red evidence: regression baseline marker is mandatory before phase 2b ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'red-evidence-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(root, `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`, 'new-feature-tests: FAIL\n');

  assertThrows(
    () => transitionPhase(feat, '2b'),
    'regression baseline'
  );
}

// ── Green evidence: target + regression markers are mandatory before phase 3 ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'green-evidence-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(root, `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`, 'target-feature-tests: PASS\n');

  assertThrows(
    () => transitionPhase(feat, '3'),
    'regression baseline'
  );
}

// ── Strict: full chain through 5, requiring adversary PASS + human approval at 1c ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'strict-feature';
  initFeature(feat, 'strict');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# B\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# V\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  assertThrows(
    () => transitionPhase(feat, '2a'),
    'Strict mode requires explicit human approval for phase 1c before phase 2a'
  );

  recordGate(feat, '1c', 'PASS', 'human', { approvedBasedOn: 'adversary' });
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  writeFile(
    root,
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
    [
      '---',
      'sprintNumber: 1',
      'feature: strict-feature',
      'status: approved',
      'criteria:',
      '  - id: CRIT-001',
      '    dimension: spec_fidelity',
      '    description: All requirements are represented in tests',
      '    weight: 0.30',
      '    passThreshold: Every REQ-XXX has at least one test',
      '---',
      '',
      '# Contract',
      '',
    ].join('\n')
  );
  writePassingReviewVerdict(
    root,
    feat,
    'contracts/sprint-1',
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
    {
      reviewContext: createContractReviewContext(root, feat),
    }
  );
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  transitionPhase(feat, '5');
  writePassingReviewVerdict(
    root,
    feat,
    'sprint-1',
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    {
      convergenceSignals: createStrictConvergenceSignals(['CRIT-001']),
    }
  );
  writeFormalHardeningArtifacts(root, feat);
  const st = readState(feat);
  st.proofObligations = [
    { id: 'PROP-001', tier: 1, required: true, status: 'proved' },
  ];
  writeState(feat, st);
  transitionPhase(feat, '6');
  transitionPhase(feat, 'complete');

  const end = readState(feat);
  assert(end.currentPhase === 'complete', 'strict should end at complete');
  assert(end.gates['1c'].adversaryVerdict === 'PASS', 'strict 1c gate should retain adversary verdict');
  assert(end.gates['1c'].humanApproved === true, 'strict 1c gate should retain human approval');
}

// ── Hook gating: contract-review artifacts are writable in 2c, sprint review artifacts are not ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'contract-review-hook-feature';
  initFeature(feat, 'strict');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# B\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# V\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  recordGate(feat, '1c', 'PASS', 'human', { approvedBasedOn: 'adversary' });
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');

  const contractReviewAllowed = runGateHook(root, {
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(root, `.vcsdd/features/${feat}/reviews/contracts/sprint-1/output/verdict.json`),
    },
  });
  assert(contractReviewAllowed.status === 0, 'contract review verdict should be writable during phase 2c');

  const sprintReviewBlocked = runGateHook(root, {
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(root, `.vcsdd/features/${feat}/reviews/sprint-1/output/verdict.json`),
    },
  });
  assert(sprintReviewBlocked.status === 2, 'sprint review verdict should stay blocked during phase 2c');
}

// ── Feedback loop: verification-architecture defects can route back to phase 1b ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'feedback-phase-1b-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  transitionPhase(feat, '3');
  writeFailingReviewVerdict(
    root,
    feat,
    'sprint-1',
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`
  );
  recordGate(feat, '3', 'FAIL', 'adversary');
  writeFile(
    root,
    `.vcsdd/features/${feat}/reviews/sprint-1/output/findings/FIND-001.json`,
    JSON.stringify({
      findingId: 'FIND-001',
      dimension: 'verification_readiness',
      category: 'verification_tool_mismatch',
      severity: 'high',
      description: 'The verification architecture no longer matches the implementation shape, so the feedback loop must return to Phase 1b.',
      evidence: {
        filePath: `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
        lineRange: '1-3',
      },
      routeToPhase: '1b',
    }, null, 2) + '\n'
  );
  routeFeedback(feat, '1b');

  const state = readState(feat);
  assert(state.currentPhase === '1b', 'feedback loop should allow routing verification-architecture findings back to phase 1b');
  assert(
    state.phaseHistory.some((entry) => entry.from === '3' && entry.to === '4'),
    'feedback routing should explicitly transition through phase 4'
  );
}

// ── Feedback routing: coherence history includes must_review convention alerts ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'feedback-coherence-conventions-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/specs/behavioral-spec.md`,
    [
      '---',
      'coherence:',
      '  node_id: "req:tenant-safety"',
      '  type: requirement',
      '  depends_on:',
      '    - id: "design:db"',
      '  conventions:',
      '    - targets:',
      '        - "module:tenant-guard"',
      '      reason: "Tenant isolation review"',
      '---',
      '# Behavioral',
      '',
    ].join('\n')
  );
  transitionPhase(feat, '1b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/specs/verification-architecture.md`,
    [
      '---',
      'coherence:',
      '  node_id: "design:db"',
      '  type: design',
      '---',
      '# Verification',
      '',
    ].join('\n')
  );
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  transitionPhase(feat, '3');
  writeFailingReviewVerdict(
    root,
    feat,
    'sprint-1',
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`
  );
  recordGate(feat, '3', 'FAIL', 'adversary');
  writeFile(
    root,
    `.vcsdd/features/${feat}/reviews/sprint-1/output/findings/FIND-001.json`,
    JSON.stringify({
      findingId: 'FIND-001',
      dimension: 'verification_readiness',
      category: 'verification_tool_mismatch',
      severity: 'high',
      description: 'Database design drift requires a spec-side fix before implementation can proceed.',
      evidence: {
        filePath: `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
        lineRange: '1-3',
      },
      routeToPhase: '1b',
    }, null, 2) + '\n'
  );

  routeFeedback(feat, '1b', 'Revisit design:db after adversary finding');

  const historyEvents = readHistoryEvents(root);
  const coherenceEvents = historyEvents.filter((event) => event.event === 'coherence_impact');
  assert(coherenceEvents.length >= 1, 'feedback routing should append a coherence_impact history event');

  const coherenceEvent = coherenceEvents[coherenceEvents.length - 1];
  assert(
    Array.isArray(coherenceEvent.startNodes) && coherenceEvent.startNodes.includes('design:db'),
    'coherence_impact history event should record the inferred start node',
  );
  assert(
    Array.isArray(coherenceEvent.conventionAlerts) && coherenceEvent.conventionAlerts.length === 1,
    'coherence_impact history event should include one convention alert',
  );
  assert(
    coherenceEvent.conventionAlerts[0].sourceNode === 'req:tenant-safety',
    'convention alert should retain the parent source node',
  );
  assert(
    coherenceEvent.conventionAlerts[0].targetId === 'module:tenant-guard',
    'convention alert should retain the must_review target',
  );
  assert(
    coherenceEvent.conventionAlerts[0].reason === 'Tenant isolation review',
    'convention alert should retain the reason from frontmatter',
  );
}

// ── Lean: adversary iteration limit is 3, not 5 ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'lean-iteration-limit-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );

  assert(getIterationLimit(readState(feat), '3') === 3, 'lean mode should cap phase 3 at 3 iterations');

  const state = readState(feat);
  state.iterations['3'] = 3;
  writeState(feat, state);

  assertThrows(
    () => transitionPhase(feat, '3'),
    'Iteration limit exceeded for phase 3 (4/3)'
  );
}

// ── Feedback routing: earliest route is enforced, and phase 5 is allowed only when all findings target phase 5 ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'feedback-route-phase5-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  transitionPhase(feat, '3');
  writeFailingReviewVerdict(
    root,
    feat,
    'sprint-1',
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`
  );
  recordGate(feat, '3', 'FAIL', 'adversary');
  writeFile(
    root,
    `.vcsdd/features/${feat}/reviews/sprint-1/output/findings/FIND-001.json`,
    JSON.stringify({
      findingId: 'FIND-001',
      dimension: 'verification_readiness',
      category: 'proof_gap',
      severity: 'high',
      description: 'A required proof harness is missing for the parser invariant, so the current hardening plan cannot establish the claimed safety property.',
      evidence: {
        filePath: `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
        lineRange: '1-3',
      },
      routeToPhase: '5',
    }, null, 2) + '\n'
  );

  routeFeedback(feat, '5');

  const phase5State = readState(feat);
  assert(phase5State.currentPhase === '5', 'feedback routing should allow phase 4 -> 5 when all current findings target phase 5');
  assert(
    phase5State.phaseHistory.some((entry) => entry.from === '4' && entry.to === '5'),
    'feedback routing should record the explicit 4 -> 5 transition'
  );
}

// ── Feedback routing: runtime blocks skipping an earlier routed phase ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'feedback-earliest-route-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  transitionPhase(feat, '3');
  writeFailingReviewVerdict(
    root,
    feat,
    'sprint-1',
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`
  );
  recordGate(feat, '3', 'FAIL', 'adversary');
  writeFile(
    root,
    `.vcsdd/features/${feat}/reviews/sprint-1/output/findings/FIND-001.json`,
    JSON.stringify({
      findingId: 'FIND-001',
      dimension: 'verification_readiness',
      category: 'verification_tool_mismatch',
      severity: 'high',
      description: 'The selected verification tool cannot prove the property currently claimed by the verification architecture, so the routing must return to Phase 1b.',
      evidence: {
        filePath: `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
        lineRange: '1-3',
      },
      routeToPhase: '1b',
    }, null, 2) + '\n'
  );

  assertThrows(
    () => routeFeedback(feat, '5'),
    'Earliest feedback route is phase 1b'
  );
  assert(readState(feat).currentPhase === '3', 'routeFeedback should not partially move into phase 4 when the target phase is invalid');
}

// ── Feedback routing: direct phase 4 exits also respect the earliest route ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'feedback-direct-transition-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  transitionPhase(feat, '3');
  writeFailingReviewVerdict(
    root,
    feat,
    'sprint-1',
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`
  );
  recordGate(feat, '3', 'FAIL', 'adversary');
  writeFile(
    root,
    `.vcsdd/features/${feat}/reviews/sprint-1/output/findings/FIND-001.json`,
    JSON.stringify({
      findingId: 'FIND-001',
      dimension: 'verification_readiness',
      category: 'verification_tool_mismatch',
      severity: 'high',
      description: 'The verification architecture itself is wrong, so feedback must return to Phase 1b before any later phase can proceed.',
      evidence: {
        filePath: `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
        lineRange: '1-3',
      },
      routeToPhase: '1b',
    }, null, 2) + '\n'
  );

  transitionPhase(feat, '4');
  assertThrows(
    () => transitionPhase(feat, '2a'),
    'Earliest feedback route is phase 1b'
  );
  assert(readState(feat).currentPhase === '4', 'failed phase 4 exit should leave the feature in phase 4');
}

// ── Phase 6 requires verification, security, and purity artifacts ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'formal-hardening-artifacts-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  transitionPhase(feat, '5');

  writeFile(
    root,
    `.vcsdd/features/${feat}/verification/verification-report.md`,
    '# Verification Report\n\n## Proof Obligations\n\n| ID | Tier | Required | Status | Tool | Artifact |\n|----|------|----------|--------|------|----------|\n\n## Summary\n\n- Required obligations: 0\n'
  );
  writeFile(
    root,
    `.vcsdd/features/${feat}/verification/purity-audit.md`,
    '# Purity Boundary Audit\n\n## Declared Boundaries\n\n- Pure core: parser core\n\n## Observed Boundaries\n\n- No drift detected.\n\n## Summary\n\n- Overall status: PASS\n'
  );
  assertThrows(
    () => transitionPhase(feat, '6'),
    'security-report.md not found'
  );

  writeFile(
    root,
    `.vcsdd/features/${feat}/verification/security-report.md`,
    '# Security Hardening Report\n\n## Tooling\n\n- Semgrep: not_applicable\n\n## Summary\n\n- Overall status: PASS\n'
  );
  assertThrows(
    () => transitionPhase(feat, '6'),
    'security-results/ must contain at least one captured output artifact'
  );

  writeFile(root, `.vcsdd/features/${feat}/verification/security-results/tooling.log`, 'semgrep: not_applicable\n');
  fs.rmSync(path.join(root, `.vcsdd/features/${feat}/verification/purity-audit.md`), { force: true });
  assertThrows(
    () => transitionPhase(feat, '6'),
    'purity-audit.md not found'
  );
}

// ── Phase 6 requires hardening artifacts generated after entering phase 5 ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'stale-hardening-artifacts-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  writeFormalHardeningArtifacts(root, feat);
  const staleTimestamp = new Date('2000-01-01T00:00:00.000Z');
  for (const artifactPath of [
    `.vcsdd/features/${feat}/verification/verification-report.md`,
    `.vcsdd/features/${feat}/verification/security-report.md`,
    `.vcsdd/features/${feat}/verification/purity-audit.md`,
    `.vcsdd/features/${feat}/verification/security-results/tooling.log`,
  ]) {
    fs.utimesSync(path.join(root, artifactPath), staleTimestamp, staleTimestamp);
  }
  transitionPhase(feat, '5');

  assertThrows(
    () => transitionPhase(feat, '6'),
    'verification-report.md must be recorded after entering phase 5'
  );
}

// ── Phase 6 rejects malformed hardening reports even when files exist ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'malformed-hardening-report-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  transitionPhase(feat, '5');

  writeFile(root, `.vcsdd/features/${feat}/verification/verification-report.md`, '# Verification Report\n');
  writeFile(root, `.vcsdd/features/${feat}/verification/security-report.md`, '# Security Hardening Report\n\n## Tooling\n');
  writeFile(root, `.vcsdd/features/${feat}/verification/purity-audit.md`, '# Purity Boundary Audit\n');
  writeFile(root, `.vcsdd/features/${feat}/verification/security-results/tooling.log`, 'semgrep: not_applicable\n');

  assertThrows(
    () => transitionPhase(feat, '6'),
    'verification-report.md is missing required content'
  );
}

// ── Required proof obligations must be proved; skipped blocks phase 6 ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'required-proof-skipped-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  transitionPhase(feat, '5');
  writeFormalHardeningArtifacts(root, feat);

  const skippedProofState = readState(feat);
  skippedProofState.proofObligations = [
    { id: 'PROP-001', tier: 1, required: true, status: 'skipped' },
  ];
  writeState(feat, skippedProofState);

  assertThrows(
    () => transitionPhase(feat, '6'),
    'Required proof obligations not met: PROP-001'
  );
}

// ── Convergence: duplicate findings must block completion ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'duplicate-findings-feature';
  initFeature(feat, 'strict');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# B\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# V\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  recordGate(feat, '1c', 'PASS', 'human', { approvedBasedOn: 'adversary' });
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  writeFile(
    root,
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
    [
      '---',
      'sprintNumber: 1',
      'feature: duplicate-findings-feature',
      'status: approved',
      'criteria:',
      '  - id: CRIT-001',
      '    dimension: spec_fidelity',
      '    description: All requirements are represented in tests',
      '    weight: 0.30',
      '    passThreshold: Every REQ-XXX has at least one test',
      '---',
      '',
      '# Contract',
      '',
    ].join('\n')
  );
  writePassingReviewVerdict(
    root,
    feat,
    'contracts/sprint-1',
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
    {
      reviewContext: createContractReviewContext(root, feat),
    }
  );
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  transitionPhase(feat, '5');
  writePassingReviewVerdict(
    root,
    feat,
    'sprint-1',
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    {
      iteration: 2,
      convergenceSignals: createStrictConvergenceSignals(['CRIT-001'], {
        duplicateFindings: ['FIND-001'],
      }),
    }
  );
  writeFormalHardeningArtifacts(root, feat);
  transitionPhase(feat, '6');

  assertThrows(
    () => transitionPhase(feat, 'complete'),
    'duplicate findings'
  );
}

// ── Convergence: open adversary findings must block completion ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'open-finding-feature';
  initFeature(feat, 'strict');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# B\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# V\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  recordGate(feat, '1c', 'PASS', 'human', { approvedBasedOn: 'adversary' });
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  writeFile(
    root,
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
    [
      '---',
      'sprintNumber: 1',
      'feature: open-finding-feature',
      'status: approved',
      'criteria:',
      '  - id: CRIT-001',
      '    dimension: spec_fidelity',
      '    description: All requirements are represented in tests',
      '    weight: 0.30',
      '    passThreshold: Every REQ-XXX has at least one test',
      '---',
      '',
      '# Contract',
      '',
    ].join('\n')
  );
  writePassingReviewVerdict(
    root,
    feat,
    'contracts/sprint-1',
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
    {
      reviewContext: createContractReviewContext(root, feat),
    }
  );
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  transitionPhase(feat, '5');
  writePassingReviewVerdict(
    root,
    feat,
    'sprint-1',
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    {
      iteration: 2,
      convergenceSignals: createStrictConvergenceSignals(['CRIT-001']),
    }
  );
  writeFormalHardeningArtifacts(root, feat);
  traceability.createBead(feat, {
    type: 'adversary-finding',
    artifactPath: `.vcsdd/features/${feat}/reviews/sprint-1/output/findings/FIND-001.json`,
    status: 'open',
    externalId: 'FIND-001',
  });
  transitionPhase(feat, '6');

  assertThrows(
    () => transitionPhase(feat, 'complete'),
    'Open adversary findings'
  );
}

// ── Convergence: every persisted finding must have a matching adversary-finding bead ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'missing-finding-bead-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# B\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# V\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  transitionPhase(feat, '5');
  writePassingReviewVerdict(
    root,
    feat,
    'sprint-1',
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    {
      iteration: 2,
      convergenceSignals: {
        findingCount: 0,
        previousFindingCount: 1,
        allCriteriaEvaluated: true,
        duplicateFindings: [],
      },
    }
  );
  writeFile(
    root,
    `.vcsdd/features/${feat}/reviews/sprint-1/output/findings/FIND-001.json`,
    JSON.stringify({
      findingId: 'FIND-001',
      dimension: 'edge_case_coverage',
      category: 'test_quality',
      severity: 'medium',
      description: 'The current test suite asserts implementation details instead of behavior in the parser regression path.',
      evidence: {
        filePath: `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
        lineRange: '1-2',
      },
      routeToPhase: '2a',
    }, null, 2) + '\n'
  );
  writeFormalHardeningArtifacts(root, feat);
  transitionPhase(feat, '6');

  assertThrows(
    () => transitionPhase(feat, 'complete'),
    'no adversary-finding bead exists for FIND-001'
  );
}

// ── Convergence: finding specificity scans persisted findings across all sprint directories ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'persisted-finding-specificity-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# B\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# V\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  transitionPhase(feat, '5');
  writePassingReviewVerdict(
    root,
    feat,
    'sprint-1',
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    {
      iteration: 2,
      convergenceSignals: {
        findingCount: 0,
        previousFindingCount: 1,
        allCriteriaEvaluated: true,
        duplicateFindings: [],
      },
    }
  );
  writeFormalHardeningArtifacts(root, feat);
  transitionPhase(feat, '6');
  writeFile(
    root,
    `.vcsdd/features/${feat}/reviews/sprint-2/output/findings/FIND-777.json`,
    JSON.stringify({
      findingId: 'FIND-777',
      dimension: 'edge_case_coverage',
      category: 'test_quality',
      severity: 'medium',
      description: 'A persisted adversary finding from an earlier review cycle still cites a hallucinated location, so convergence must remain blocked until the evidence is corrected.',
      evidence: {
        filePath: `.vcsdd/features/${feat}/src/nonexistent.js`,
        lineRange: '1-2',
      },
      routeToPhase: '2a',
    }, null, 2) + '\n'
  );
  traceability.createBead(feat, {
    type: 'adversary-finding',
    artifactPath: `.vcsdd/features/${feat}/reviews/sprint-2/output/findings/FIND-777.json`,
    status: 'resolved',
    externalId: 'FIND-777',
  });

  assertThrows(
    () => transitionPhase(feat, 'complete'),
    'evidence.filePath is missing or does not exist'
  );
}

// ── Convergence: later iterations must reduce findings versus previousFindingCount ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'non-diminishing-findings-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# B\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# V\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  transitionPhase(feat, '5');
  writePassingReviewVerdict(
    root,
    feat,
    'sprint-1',
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    {
      iteration: 2,
      convergenceSignals: {
        findingCount: 0,
        previousFindingCount: 0,
        allCriteriaEvaluated: true,
        duplicateFindings: [],
      },
    }
  );
  writeFormalHardeningArtifacts(root, feat);
  transitionPhase(feat, '6');

  assertThrows(
    () => transitionPhase(feat, 'complete'),
    'findings to decrease'
  );
}

// ── Strict: contract review PASS is mandatory before phase 3 ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'strict-contract-review-feature';
  initFeature(feat, 'strict');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# B\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# V\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  recordGate(feat, '1c', 'PASS', 'human', { approvedBasedOn: 'adversary' });
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  writeFile(
    root,
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
    [
      '---',
      'sprintNumber: 1',
      `feature: ${feat}`,
      'status: approved',
      'criteria:',
      '  - id: CRIT-001',
      '    dimension: spec_fidelity',
      '    description: All requirements remain reviewable after refactor',
      '    weight: 0.30',
      '    passThreshold: Each REQ-XXX maps to at least one reviewed artifact',
      '---',
      '',
      '# Contract',
      '',
    ].join('\n')
  );

  assertThrows(
    () => transitionPhase(feat, '3'),
    'Contract review PASS required'
  );

  writePassingReviewVerdict(
    root,
    feat,
    'contracts/sprint-1',
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
    {
      reviewContext: createContractReviewContext(root, feat),
    }
  );
  transitionPhase(feat, '3');

  const state = readState(feat);
  assert(state.currentPhase === '3', 'strict feature should enter phase 3 after contract review PASS');
}

// ── Strict: contract review verdict must match the currently approved contract content ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'stale-contract-review-feature';
  initFeature(feat, 'strict');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# B\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# V\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  recordGate(feat, '1c', 'PASS', 'human', { approvedBasedOn: 'adversary' });
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  writeFile(
    root,
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
    [
      '---',
      'sprintNumber: 1',
      `feature: ${feat}`,
      'status: approved',
      'criteria:',
      '  - id: CRIT-001',
      '    dimension: spec_fidelity',
      '    description: Contract and reviewed artifacts stay aligned',
      '    weight: 0.30',
      '    passThreshold: Each REQ-XXX maps to at least one reviewed artifact',
      '---',
      '',
      '# Contract',
      '',
    ].join('\n')
  );

  writePassingReviewVerdict(
    root,
    feat,
    'contracts/sprint-1',
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
    {
      reviewContext: createContractReviewContext(root, feat),
    }
  );
  writeFile(
    root,
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
    [
      '---',
      'sprintNumber: 1',
      `feature: ${feat}`,
      'status: approved',
      'criteria:',
      '  - id: CRIT-001',
      '    dimension: spec_fidelity',
      '    description: Contract and reviewed artifacts stay aligned',
      '    weight: 0.30',
      '    passThreshold: Each REQ-XXX maps to at least one reviewed artifact and one proof artifact',
      '---',
      '',
      '# Contract',
      '',
    ].join('\n')
  );

  assertThrows(
    () => transitionPhase(feat, '3'),
    'does not match the currently approved sprint contract content'
  );
}

// ── Strict: criteria coverage must match the approved contract exactly before phase 6 ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'criteria-coverage-feature';
  initFeature(feat, 'strict');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# B\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# V\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  recordGate(feat, '1c', 'PASS', 'human', { approvedBasedOn: 'adversary' });
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  writeFile(
    root,
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
    [
      '---',
      'sprintNumber: 1',
      `feature: ${feat}`,
      'status: approved',
      'criteria:',
      '  - id: CRIT-001',
      '    dimension: spec_fidelity',
      '    description: Requirements are reviewed against artifacts',
      '    weight: 0.30',
      '    passThreshold: Every REQ-XXX is evidence-backed',
      '  - id: CRIT-002',
      '    dimension: verification_readiness',
      '    description: Proof obligations remain reviewable',
      '    weight: 0.30',
      '    passThreshold: Every required PROP-XXX is checked against proof artifacts',
      '---',
      '',
      '# Contract',
      '',
    ].join('\n')
  );
  writePassingReviewVerdict(
    root,
    feat,
    'contracts/sprint-1',
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
    {
      reviewContext: createContractReviewContext(root, feat),
    }
  );
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  transitionPhase(feat, '5');
  writePassingReviewVerdict(
    root,
    feat,
    'sprint-1',
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    {
      convergenceSignals: createStrictConvergenceSignals(['CRIT-001']),
    }
  );
  writeFormalHardeningArtifacts(root, feat);

  assertThrows(
    () => transitionPhase(feat, '6'),
    'missing evaluated criteria: CRIT-002'
  );
}

// ── Strict: contract review negotiation is capped at two rounds ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'contract-negotiation-limit-feature';
  initFeature(feat, 'strict');

  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# B\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# V\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  recordGate(feat, '1c', 'PASS', 'human', { approvedBasedOn: 'adversary' });
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  writeFile(
    root,
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
    [
      '---',
      'sprintNumber: 1',
      `feature: ${feat}`,
      'status: approved',
      'negotiationRound: 2',
      'criteria:',
      '  - id: CRIT-001',
      '    dimension: spec_fidelity',
      '    description: Requirements remain concrete after negotiation',
      '    weight: 0.30',
      '    passThreshold: Every REQ-XXX is still reviewable from disk artifacts',
      '---',
      '',
      '# Contract',
      '',
    ].join('\n')
  );
  writePassingReviewVerdict(
    root,
    feat,
    'contracts/sprint-1',
    `.vcsdd/features/${feat}/contracts/sprint-1.md`,
    {
      iteration: 3,
      reviewContext: createContractReviewContext(root, feat),
    }
  );

  assertThrows(
    () => transitionPhase(feat, '3'),
    'negotiation limit exceeded'
  );
  const escalationDir = path.join(root, `.vcsdd/features/${feat}/escalations`);
  assert(fs.existsSync(escalationDir), 'contract review escalation should be written after exceeding negotiation limit');
  assert(fs.readdirSync(escalationDir).length > 0, 'contract review escalation directory should contain an escalation record');
}

// ── complete → 1a: next sprint cycle from spec re-crystallization ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'complete-to-1a-feature';
  initFeature(feat, 'lean');

  // Run a minimal lean sprint to reach complete
  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  writeFile(
    root,
    `.vcsdd/features/${feat}/reviews/sprint-1/output/verdict.json`,
    JSON.stringify(
      createPassingVerdict(
        feat, 1, 1,
        `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
        { findingCount: 0, previousFindingCount: 1, allCriteriaEvaluated: true, duplicateFindings: [] }
      ),
      null, 2
    ) + '\n'
  );
  transitionPhase(feat, '5');
  writeFormalHardeningArtifacts(root, feat, {
    verificationReport: [
      '# Verification Report', '', '## Proof Obligations', '',
      'No required proof obligations.', '', '## Summary', '',
      '- Required obligations: 0', '- Proved: 0', '- Failed: 0',
    ].join('\n') + '\n',
  });
  transitionPhase(feat, '6');
  transitionPhase(feat, 'complete');

  assert(readState(feat).currentPhase === 'complete', 'should reach complete');

  // Now start the next sprint cycle from spec re-crystallization
  transitionPhase(feat, '1a', 'start sprint 2 cycle');

  const st2 = readState(feat);
  assert(st2.currentPhase === '1a', 'complete → 1a should succeed');
  // sprintCount is NOT incremented yet (that happens at 1c → 2a)
  assert(st2.sprintCount === 1, 'sprintCount should still be 1 until 1c → 2a');

  // phaseHistory entry for complete → 1a should carry nextSprintHint
  const histEntry = st2.phaseHistory[st2.phaseHistory.length - 1];
  assert(histEntry.from === 'complete', 'history from should be complete');
  assert(histEntry.to === '1a', 'history to should be 1a');
  assert(histEntry.nextSprintHint === 2, 'nextSprintHint should be 2');

  // history.jsonl should contain sprint_boundary event
  const historyPath = vcsdd.getHistoryPath();
  const histLines = fs.readFileSync(historyPath, 'utf8').trim().split('\n');
  const boundaryEvents = histLines
    .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter((e) => e && e.event === 'sprint_boundary' && e.featureName === feat);
  assert(boundaryEvents.length >= 1, 'history.jsonl should contain sprint_boundary event');
  assert(boundaryEvents[boundaryEvents.length - 1].nextSprintHint === 2, 'sprint_boundary nextSprintHint should be 2');

  // Verify the transition was actually recorded in history.jsonl (not missed)
  const transitionEvents = histLines
    .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter((e) => e && e.event === 'phase_transition' && e.from === 'complete' && e.featureName === feat);
  assert(transitionEvents.length >= 1, 'complete → 1a phase_transition should be recorded in history.jsonl');
}

// ── complete → 3: re-enter adversarial review without full spec rewrite ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'complete-to-3-feature';
  initFeature(feat, 'lean');

  // Run a minimal lean sprint to reach complete
  transitionPhase(feat, '1a');
  writeFile(root, `.vcsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vcsdd/features/${feat}/specs/verification-architecture.md`, '# Verification\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-red-phase.log`,
    'new-feature-tests: FAIL\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2b');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\n'
  );
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
    'target-feature-tests: PASS\nregression-baseline: PASS\nafter-refactor: PASS\n'
  );
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  writeFile(
    root,
    `.vcsdd/features/${feat}/reviews/sprint-1/output/verdict.json`,
    JSON.stringify(
      createPassingVerdict(
        feat, 1, 1,
        `.vcsdd/features/${feat}/evidence/sprint-1-green-phase.log`,
        { findingCount: 0, previousFindingCount: 1, allCriteriaEvaluated: true, duplicateFindings: [] }
      ),
      null, 2
    ) + '\n'
  );
  transitionPhase(feat, '5');
  writeFormalHardeningArtifacts(root, feat, {
    verificationReport: [
      '# Verification Report', '', '## Proof Obligations', '',
      'No required proof obligations.', '', '## Summary', '',
      '- Required obligations: 0', '- Proved: 0', '- Failed: 0',
    ].join('\n') + '\n',
  });
  transitionPhase(feat, '6');
  transitionPhase(feat, 'complete');

  assert(readState(feat).currentPhase === 'complete', 'should reach complete');

  // Re-enter adversarial review directly from complete
  transitionPhase(feat, '3', 're-review after deploy feedback');

  const st3 = readState(feat);
  assert(st3.currentPhase === '3', 'complete → 3 should succeed');
  assert(st3.sprintCount === 1, 'sprintCount should remain 1 for complete → 3 path');

  // phaseHistory entry should carry nextSprintHint (complete is the predecessor)
  const histEntry3 = st3.phaseHistory[st3.phaseHistory.length - 1];
  assert(histEntry3.from === 'complete', 'history from should be complete');
  assert(histEntry3.to === '3', 'history to should be 3');
  assert(histEntry3.nextSprintHint === 2, 'nextSprintHint should be 2 for complete → 3');

  // history.jsonl should contain both phase_transition and sprint_boundary events
  const historyPath3 = vcsdd.getHistoryPath();
  const histLines3 = fs.readFileSync(historyPath3, 'utf8').trim().split('\n');
  const transEvents3 = histLines3
    .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter((e) => e && e.event === 'phase_transition' && e.from === 'complete' && e.featureName === feat);
  assert(transEvents3.length >= 1, 'complete → 3 phase_transition should be recorded in history.jsonl');
}

// eslint-disable-next-line no-console
console.log('verify-vcsdd-state: OK');
