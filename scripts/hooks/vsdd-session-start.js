'use strict';

const { run } = require('./run-with-flags');
const { getActiveFeature, readState, readIndex, getVsddRoot } = require('../lib/vsdd-state');
const fs = require('fs');
const path = require('path');

run('vsdd-session-start', async (_payload) => {
  const vsddRoot = getVsddRoot();

  // If no .vsdd directory, this is not a VSDD project - silently exit
  if (!fs.existsSync(vsddRoot)) {
    return { blocked: false };
  }

  try {
    const index = readIndex();
    const activeFeature = index.activeFeature;

    if (!activeFeature) {
      process.stdout.write(
        '\n📋 **VSDD**: No active feature. Use `/vsdd-init <name>` to start a feature pipeline.\n\n'
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
      `📋 **VSDD Active**: \`${activeFeature}\` | Mode: ${state.mode}${langLine} | ${phaseDesc}`,
      `   Sprint: ${state.sprintCount} | Iteration: ${state.iterations[state.currentPhase] || 0}`,
    ];

    if (openFindings > 0) {
      lines.push(`   ⚠️  ${openFindings} open adversary finding(s) pending resolution`);
    }
    if (pendingProofs > 0) {
      lines.push(`   🔬 ${pendingProofs} required proof obligation(s) pending`);
    }

    const nextAction = getNextAction(state.currentPhase);
    if (nextAction) {
      lines.push(`   ➡️  Next: ${nextAction}`);
    }

    lines.push('');
    process.stdout.write(lines.join('\n') + '\n');
  } catch (err) {
    process.stderr.write(`[vsdd-session-start] Warning: ${err.message}\n`);
  }

  return { blocked: false };
});

function getNextAction(phase) {
  const actions = {
    'init': 'Run `/vsdd-spec` to begin behavioral specification',
    '1a': 'Complete behavioral spec, then run `/vsdd-spec` for verification architecture',
    '1b': 'Complete verification architecture, then run `/vsdd-spec-review`',
    '1c': 'Awaiting spec review gate - run `/vsdd-spec-review`',
    '2a': 'Generate failing tests with `/vsdd-tdd`',
    '2b': 'Implement to pass tests with `/vsdd-impl`',
    '2c': 'Refactor and run `/vsdd-impl` to finish',
    '3': 'Run adversarial review with `/vsdd-adversary`',
    '4': 'Route feedback with `/vsdd-feedback`',
    '5': 'Run formal verification with `/vsdd-harden`',
    '6': 'Check convergence with `/vsdd-converge`',
    'complete': null,
  };
  return actions[phase] || null;
}
