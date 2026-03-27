'use strict';

const { run } = require('./run-with-flags');
const { getActiveFeature, readState, appendHistory, getVsddRoot } = require('../lib/vsdd-state');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

run('vsdd-auto-commit', async (payload) => {
  // Auto-commit is disabled by default - must opt in explicitly
  if (!process.env.VSDD_AUTO_COMMIT || process.env.VSDD_AUTO_COMMIT.toLowerCase() !== 'true') {
    return { blocked: false };
  }

  const vsddRoot = getVsddRoot();
  if (!fs.existsSync(vsddRoot)) {
    return { blocked: false };
  }

  try {
    const activeFeature = getActiveFeature();
    if (!activeFeature) {
      return { blocked: false };
    }

    const state = readState(activeFeature);

    // Check if this is a phase completion event (phase changed since last commit)
    const lastCommitPhaseFile = path.join(vsddRoot, '.last-commit-phase');
    const lastCommitPhase = fs.existsSync(lastCommitPhaseFile)
      ? fs.readFileSync(lastCommitPhaseFile, 'utf8').trim()
      : null;

    if (state.currentPhase === lastCommitPhase) {
      return { blocked: false }; // No phase change, skip
    }

    // Check if worktree is clean enough for atomic staging
    let status;
    try {
      status = execSync('git status --porcelain', { encoding: 'utf8', cwd: process.cwd() });
    } catch (_e) {
      return { blocked: false }; // Not a git repo or git not available
    }

    const dirtyFiles = status.trim().split('\n').filter(Boolean);
    const vsddRelative = vsddRoot.replace(process.cwd() + '/', '');
    const unrelatedDirty = dirtyFiles.filter(line => {
      const file = line.slice(3);
      return !file.startsWith(vsddRelative) && !file.match(/^(src|tests?|lib)\//);
    });

    if (unrelatedDirty.length > 0) {
      // Dirty worktree with unrelated changes - emit pending checkpoint, no-op
      appendHistory({
        event: 'auto_commit_skipped',
        featureName: activeFeature,
        reason: 'unrelated dirty changes in worktree',
        phase: state.currentPhase,
      });
      return { blocked: false };
    }

    // Build commit message
    const phaseDescriptions = {
      '1a': 'behavioral specification', '1b': 'verification architecture',
      '1c': 'spec review gate', '2a': 'test generation (red phase)',
      '2b': 'implementation (green phase)', '2c': 'refactor',
      '3': 'adversarial review', '4': 'feedback integration',
      '5': 'formal hardening', '6': 'convergence check', 'complete': 'pipeline complete',
    };

    const phaseDesc = phaseDescriptions[state.currentPhase] || state.currentPhase;
    const gateVerdict = state.gates[state.currentPhase]?.verdict || 'pending';

    const affectedBeads = state.traceability.beads
      .filter(b => b.createdInPhase === state.currentPhase)
      .map(b => b.beadId)
      .join(', ') || 'none';

    const commitMsg = [
      `vsdd(${state.currentPhase}): ${activeFeature} - ${phaseDesc}`,
      '',
      `Phase: ${state.currentPhase}`,
      `Feature: ${activeFeature}`,
      `Sprint: ${state.sprintCount}`,
      `Gate: ${gateVerdict}`,
      `Beads: ${affectedBeads}`,
      `Iteration: ${state.iterations[state.currentPhase] || 1}`,
    ].join('\n');

    // Git add + commit + tag
    try {
      execSync(`git add -A ${vsddRelative} src/ tests/ lib/ 2>/dev/null || git add -A ${vsddRelative}`, {
        cwd: process.cwd(), encoding: 'utf8',
      });
      execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, {
        cwd: process.cwd(), encoding: 'utf8',
      });
      const tag = `vsdd/${activeFeature}/phase-${state.currentPhase}`;
      execSync(`git tag -f "${tag}"`, { cwd: process.cwd(), encoding: 'utf8' });

      // Record the committed phase
      fs.writeFileSync(lastCommitPhaseFile, state.currentPhase, 'utf8');

      appendHistory({
        event: 'auto_commit_created',
        featureName: activeFeature,
        phase: state.currentPhase,
        tag,
      });
    } catch (commitErr) {
      process.stderr.write(`[vsdd-auto-commit] Commit failed: ${commitErr.message}\n`);
    }
  } catch (err) {
    process.stderr.write(`[vsdd-auto-commit] Error: ${err.message}\n`);
  }

  return { blocked: false };
});
