'use strict';

const { run } = require('./run-with-flags');
const { getActiveFeature, readState, appendHistory, getVsddRoot } = require('../lib/vsdd-state');
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function toPosix(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function parsePorcelainPath(line) {
  const raw = toPosix(line).slice(3).trim();
  if (!raw) return null;
  const renamed = raw.split(' -> ');
  return renamed[renamed.length - 1];
}

function phaseArtifactHints(state, activeFeature, vsddRelative) {
  const sprint = state.sprintCount || 1;
  const featureRoot = toPosix(path.join(vsddRelative, 'features', activeFeature));
  const hints = new Set([
    `${featureRoot}/`,
    `${vsddRelative}/index.json`,
    `${vsddRelative}/history.jsonl`,
    `${vsddRelative}/active-feature.txt`,
  ]);

  const byPhase = {
    '1a': ['specs/behavioral-spec.md'],
    '1b': ['specs/verification-architecture.md'],
    '2a': [
      `contracts/sprint-${sprint}.md`,
      `evidence/sprint-${sprint}-red-phase.log`,
      `evidence/sprint-${sprint}-coverage.json`,
    ],
    '2b': [`evidence/sprint-${sprint}-green-phase.log`],
    '2c': [`evidence/sprint-${sprint}-green-phase.log`],
    '3': [
      `contracts/sprint-${sprint}.md`,
      `reviews/sprint-${sprint}/input/`,
      `reviews/sprint-${sprint}/output/`,
    ],
    '5': ['verification/'],
    '6': [
      `reviews/sprint-${sprint}/output/`,
      'verification/verification-report.md',
    ],
    complete: ['verification/verification-report.md'],
  };

  for (const rel of byPhase[state.currentPhase] || []) {
    hints.add(`${featureRoot}/${rel}`);
  }

  for (const bead of state.traceability.beads || []) {
    if (bead.createdInPhase !== state.currentPhase) continue;
    if (!bead.artifactPath) continue;
    hints.add(toPosix(bead.artifactPath));
  }

  return [...hints];
}

function matchesHint(filePath, hints) {
  const normalized = toPosix(filePath);
  return hints.some(hint => normalized === hint || normalized.startsWith(hint));
}

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
    const hints = phaseArtifactHints(state, activeFeature, vsddRelative);
    const parsedDirtyFiles = dirtyFiles.map(parsePorcelainPath).filter(Boolean);
    const codeScope = /^(src|tests?|lib|app|core)\//;
    const stageableDirty = parsedDirtyFiles.filter(file => matchesHint(file, hints));
    const ambiguousCodeDirty = parsedDirtyFiles.filter(file => codeScope.test(file) && !matchesHint(file, hints));
    const unrelatedDirty = parsedDirtyFiles.filter(file => !codeScope.test(file) && !matchesHint(file, hints));

    if (ambiguousCodeDirty.length > 0 || unrelatedDirty.length > 0) {
      // Dirty worktree with files outside the current feature/phase scope - emit pending checkpoint, no-op
      appendHistory({
        event: 'auto_commit_skipped',
        featureName: activeFeature,
        reason: 'dirty changes outside current VSDD artifact scope',
        phase: state.currentPhase,
      });
      return { blocked: false };
    }

    if (stageableDirty.length === 0) {
      appendHistory({
        event: 'auto_commit_skipped',
        featureName: activeFeature,
        reason: 'no dirty files matched current VSDD artifact scope',
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
      execFileSync('git', ['add', '--', ...stageableDirty], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
      execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, {
        cwd: process.cwd(), encoding: 'utf8',
      });
      const tag = `vsdd/${activeFeature}/phase-${state.currentPhase}`;
      let tagExists = false;
      try {
        execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
          cwd: process.cwd(),
          encoding: 'utf8',
          stdio: 'pipe',
        });
        tagExists = true;
      } catch (_e) {
        tagExists = false;
      }
      if (!tagExists) {
        execFileSync('git', ['tag', tag], { cwd: process.cwd(), encoding: 'utf8' });
      }

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
