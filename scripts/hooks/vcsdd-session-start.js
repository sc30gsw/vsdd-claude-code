'use strict';

const { run } = require('./run-with-flags');
const { getActiveFeature, readState, readIndex, getVcsddRoot } = require('../lib/vcsdd-state');
const fs = require('fs');
const path = require('path');

run('vcsdd-session-start', async (_payload) => {
  const vcsddRoot = getVcsddRoot();

  // If no .vcsdd directory, this is not a VCSDD project - silently exit
  if (!fs.existsSync(vcsddRoot)) {
    return { blocked: false };
  }

  try {
    const index = readIndex();
    const activeFeature = index.activeFeature;

    if (!activeFeature) {
      process.stdout.write(
        '\n📋 **VCSDD**: No active feature. Use `/vcsdd-init <name>` to start a feature pipeline.\n\n'
      );
      return { blocked: false };
    }

    const state = readState(activeFeature);

    // Count pending items
    const openFindings = state.traceability.beads.filter(
      b => b.type === 'adversary-finding' && b.status === 'open'
    ).length;
    const pendingProofs = state.proofObligations.filter(
      p => p.required && p.status === 'pending'
    ).length;

    const phaseDescriptions = {
      'init': 'Initializing',
      '1a': 'Phase 1a: Behavioral Specification',
      '1b': 'Phase 1b: Verification Architecture',
      '1c': 'Phase 1c: Spec Review Gate',
      '2a': 'Phase 2a: Test Generation (Red)',
      '2b': 'Phase 2b: Implementation (Green)',
      '2c': 'Phase 2c: Refactor',
      '3': 'Phase 3: Adversarial Review',
      '4': 'Phase 4: Feedback Integration',
      '5': 'Phase 5: Formal Hardening',
      '6': 'Phase 6: Convergence Check',
      'complete': 'Complete ✅',
    };

    const phaseDesc = phaseDescriptions[state.currentPhase] || state.currentPhase;

    const langLine =
      state.language && typeof state.language === 'string'
        ? ` | Lang: ${state.language}`
        : '';

    const lines = [
      '',
      `📋 **VCSDD Active**: \`${activeFeature}\` | Mode: ${state.mode}${langLine} | ${phaseDesc}`,
      `   Sprint: ${state.sprintCount} | Iteration: ${state.iterations[state.currentPhase] || 0}`,
    ];

    if (openFindings > 0) {
      lines.push(`   ⚠️  ${openFindings} open adversary finding(s) pending resolution`);
    }
    if (pendingProofs > 0) {
      lines.push(`   🔬 ${pendingProofs} required proof obligation(s) pending`);
    }

    const nextAction = getNextAction(state);
    if (nextAction) {
      lines.push(`   ➡️  Next: ${nextAction}`);
    }

    lines.push('');
    process.stdout.write(lines.join('\n') + '\n');
  } catch (err) {
    process.stderr.write(`[vcsdd-session-start] Warning: ${err.message}\n`);
  }

  return { blocked: false };
});

function getNextAction(state) {
  const phase = state && state.currentPhase;
  const mode = state && state.mode;

  const actions = {
    'init': 'Run `/vcsdd-spec` to begin behavioral specification',
    '1a': 'Complete behavioral spec, then run `/vcsdd-spec` for verification architecture',
    '1b': 'Complete verification architecture, then run `/vcsdd-spec-review`',
    '1c': mode === 'strict'
      ? 'Run `/vcsdd-spec-review`; after adversary PASS, record explicit human approval'
      : 'Awaiting spec review gate - run `/vcsdd-spec-review`',
    '2a': 'Generate failing tests with `/vcsdd-tdd`',
    '2b': 'Implement to pass tests with `/vcsdd-impl`',
    '2c': mode === 'strict'
      ? 'Finish refactor, update `contracts/sprint-N.md`, then run `/vcsdd-contract-review`'
      : 'Refactor and run `/vcsdd-impl` to finish',
    '3': 'Run adversarial review with `/vcsdd-adversary`',
    '4': 'Route feedback with `/vcsdd-feedback`',
    '5': 'Run formal verification with `/vcsdd-harden`',
    '6': 'Check convergence with `/vcsdd-converge`',
    'complete': null,
  };
  return actions[phase] || null;
}
