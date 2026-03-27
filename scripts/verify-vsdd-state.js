#!/usr/bin/env node
'use strict';

/**
 * Smoke-test state machine: lean abbreviated path + strict full path.
 * Run from repo root: node scripts/verify-vsdd-state.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

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
  writeFile(root, `.vsdd/features/${feat}/evidence/sprint-1-green-phase.log`, 'All tests passing\n');
  transitionPhase(feat, '2b');
  transitionPhase(feat, '3');
  recordGate(feat, '3', 'PASS', 'adversary');
  transitionPhase(feat, '6');
  transitionPhase(feat, 'complete');

  const st = readState(feat);
  assert(st.currentPhase === 'complete', 'lean should end at complete');
}

// ── Strict: full chain through 5 ──
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
  transitionPhase(feat, '2a');
  writeFile(root, `.vsdd/features/${feat}/evidence/sprint-1-red-phase.log`, 'FAIL red phase as expected\n');
  writeFile(root, `.vsdd/features/${feat}/evidence/sprint-1-green-phase.log`, 'All tests passing\n');
  transitionPhase(feat, '2b');
  transitionPhase(feat, '2c');
  writeFile(
    root,
    `.vsdd/features/${feat}/contracts/sprint-1.md`,
    [
      '---',
      'sprintNumber: 1',
      'feature: strict-feature',
      'status: approved',
      '---',
      '',
      '## Grading Criteria',
      '',
      '### CRIT-001',
      '- **Dimension**: spec_fidelity',
      '- **Description**: All requirements are represented in tests',
      '- **Weight**: 0.30',
      '- **Pass Threshold**: Every REQ-XXX has at least one test',
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
}

// eslint-disable-next-line no-console
console.log('verify-vsdd-state: OK');
