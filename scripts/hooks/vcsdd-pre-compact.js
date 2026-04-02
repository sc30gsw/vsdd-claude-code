'use strict';

const { run } = require('./run-with-flags');
const { getActiveFeature, readState, appendHistory, getVcsddRoot } = require('../lib/vcsdd-state');
const fs = require('fs');

run('vcsdd-pre-compact', async (_payload) => {
  const vcsddRoot = getVcsddRoot();
  if (!fs.existsSync(vcsddRoot)) {
    return { blocked: false };
  }

  try {
    const activeFeature = getActiveFeature();
    if (!activeFeature) {
      return { blocked: false };
    }

    const state = readState(activeFeature);

    // Append full checkpoint to history before context compaction
    appendHistory({
      event: 'state_checkpoint',
      featureName: activeFeature,
      trigger: 'pre-compact',
      currentPhase: state.currentPhase,
      sprintCount: state.sprintCount,
      openFindings: state.traceability.beads.filter(b => b.type === 'adversary-finding' && b.status === 'open').length,
      pendingProofs: state.proofObligations.filter(p => p.required && p.status === 'pending').length,
    });

    // Output context summary so it survives compaction
    const phaseDesc = {
      '1a': 'Writing behavioral spec', '1b': 'Writing verification architecture',
      '1c': 'Spec review gate', '2a': 'Generating tests (Red)',
      '2b': 'Implementing (Green)', '2c': 'Refactoring',
      '3': 'Adversarial review', '4': 'Routing feedback',
      '5': 'Formal hardening', '6': 'Convergence check',
    }[state.currentPhase] || state.currentPhase;

    process.stdout.write(
      `\n[VCSDD Context Checkpoint] Feature: ${activeFeature} | Phase: ${state.currentPhase} (${phaseDesc}) | ` +
      `Sprint: ${state.sprintCount} | Mode: ${state.mode}\n\n`
    );
  } catch (err) {
    process.stderr.write(`[vcsdd-pre-compact] Warning: ${err.message}\n`);
  }

  return { blocked: false };
});
