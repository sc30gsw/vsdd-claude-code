#!/usr/bin/env node
'use strict';

/**
 * Smoke-test the state machine and gate enforcement.
 * Run from repo root: node scripts/verify-vsdd-state.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const vsdd = require('./lib/vsdd-state');
const {
  initFeature,
  readState,
  transitionPhase,
  recordGate,
  writeState,
  getLanguageForFeature,
  getActiveFeaturePath,
} = vsdd;

const gateHookPath = path.join(__dirname, 'hooks', 'vsdd-gate-check.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vsdd-verify-'));
}

function writeFile(absRoot, rel, content = 'ok\n') {
  const p = path.join(absRoot, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
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

function runGateHook(root, payload) {
  return spawnSync('node', [gateHookPath], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
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
}

// ── Lean: 1a -> 1c -> 2a -> 2b -> 3 -> 6 -> complete (skip 1b, 2c, 5) ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'lean-feature';
  initFeature(feat, 'lean', 'typescript');
  assert(getLanguageForFeature(feat) === 'typescript', 'language should be typescript');
  assert(fs.existsSync(getActiveFeaturePath()), 'active-feature.txt should exist after init');
  assert(fs.readFileSync(getActiveFeaturePath(), 'utf8').trim() === feat, 'active-feature.txt should match feature');

  transitionPhase(feat, '1a');
  writeFile(root, `.vsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(root, `.vsdd/features/${feat}/evidence/sprint-1-red-phase.log`, 'FAIL red phase as expected\n');
  transitionPhase(feat, '2b');
  writeFile(root, `.vsdd/features/${feat}/evidence/sprint-1-green-phase.log`, 'All tests passing\n');
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  transitionPhase(feat, '6');
  transitionPhase(feat, 'complete');

  const st = readState(feat);
  assert(st.currentPhase === 'complete', 'lean should end at complete');
}

// ── Freshness: pre-written green evidence must not satisfy phase 2c ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'freshness-feature';
  initFeature(feat, 'lean');

  transitionPhase(feat, '1a');
  writeFile(root, `.vsdd/features/${feat}/specs/behavioral-spec.md`, '# Behavioral\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  transitionPhase(feat, '2a');
  writeFile(root, `.vsdd/features/${feat}/evidence/sprint-1-red-phase.log`, 'FAIL red phase as expected\n');
  writeFile(root, `.vsdd/features/${feat}/evidence/sprint-1-green-phase.log`, 'All tests passing\n');
  const staleGreenLog = path.join(root, `.vsdd/features/${feat}/evidence/sprint-1-green-phase.log`);
  const staleDate = new Date(Date.now() - 5000);
  fs.utimesSync(staleGreenLog, staleDate, staleDate);
  transitionPhase(feat, '2b');

  assertThrows(
    () => transitionPhase(feat, '2c'),
    'Green phase evidence (sprint-1-green-phase.log) must be recorded after entering phase 2b'
  );
}

// ── Strict: full chain through 5, requiring adversary PASS + human approval at 1c ──
{
  const root = tmpDir();
  process.chdir(root);
  const feat = 'strict-feature';
  initFeature(feat, 'strict');

  transitionPhase(feat, '1a');
  writeFile(root, `.vsdd/features/${feat}/specs/behavioral-spec.md`, '# B\n');
  transitionPhase(feat, '1b');
  writeFile(root, `.vsdd/features/${feat}/specs/verification-architecture.md`, '# V\n');
  transitionPhase(feat, '1c');
  recordGate(feat, '1c', 'PASS', 'adversary');
  assertThrows(
    () => transitionPhase(feat, '2a'),
    'Strict mode requires explicit human approval for phase 1c before phase 2a'
  );

  recordGate(feat, '1c', 'PASS', 'human', { approvedBasedOn: 'adversary' });
  transitionPhase(feat, '2a');
  writeFile(root, `.vsdd/features/${feat}/evidence/sprint-1-red-phase.log`, 'FAIL red phase as expected\n');
  transitionPhase(feat, '2b');
  writeFile(root, `.vsdd/features/${feat}/evidence/sprint-1-green-phase.log`, 'All tests passing\n');
  transitionPhase(feat, '2c');
  writeFile(root, `.vsdd/features/${feat}/evidence/sprint-1-green-phase.log`, 'All tests passing after refactor\n');
  writeFile(
    root,
    `.vsdd/features/${feat}/contracts/sprint-1.md`,
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
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  transitionPhase(feat, '5');
  writeFile(
    root,
    `.vsdd/features/${feat}/reviews/sprint-1/output/verdict.json`,
    JSON.stringify({
      sprintNumber: 1,
      feature: feat,
      overallVerdict: 'PASS',
      timestamp: new Date().toISOString(),
      iteration: 1,
      dimensions: [
        { name: 'spec_fidelity', verdict: 'PASS', findings: [] },
      ],
      convergenceSignals: {
        findingCount: 0,
        allCriteriaEvaluated: true,
        duplicateFindings: [],
      },
    }, null, 2) + '\n'
  );
  writeFile(root, `.vsdd/features/${feat}/verification/verification-report.md`, '# Report\n');
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

// eslint-disable-next-line no-console
console.log('verify-vsdd-state: OK');
