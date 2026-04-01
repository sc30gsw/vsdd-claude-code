'use strict';

const { run } = require('./run-with-flags');
const { getActiveFeature, readState, appendHistory, getVcsddRoot } = require('../lib/vcsdd-state');
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const IMPLEMENTATION_HINTS = [
  'src/',
  'tests/',
  'test/',
  '__tests__/',
  'lib/',
  'app/',
  'core/',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'Cargo.toml',
  'Cargo.lock',
  'pyproject.toml',
  'poetry.lock',
  'requirements.txt',
  'requirements-dev.txt',
  'go.mod',
  'go.sum',
  'CMakeLists.txt',
];

function toPosix(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function parsePorcelainPath(line) {
  const raw = toPosix(line).slice(3).trim();
  if (!raw) return null;
  const renamed = raw.split(' -> ');
  return renamed[renamed.length - 1];
}

function phaseArtifactHints(state, activeFeature, vcsddRelative) {
  const sprint = state.sprintCount || 1;
  const featureRoot = toPosix(path.join(vcsddRelative, 'features', activeFeature));
  const hints = new Set([
    `${featureRoot}/`,
    `${vcsddRelative}/index.json`,
    `${vcsddRelative}/history.jsonl`,
    `${vcsddRelative}/active-feature.txt`,
  ]);

  const byPhase = {
    '1a': ['specs/behavioral-spec.md'],
    '1b': ['specs/verification-architecture.md'],
    '2a': [
      ...IMPLEMENTATION_HINTS.filter((hint) => hint.includes('test') || hint.startsWith('__tests__') || !hint.endsWith('/')),
      `contracts/sprint-${sprint}.md`,
      `evidence/sprint-${sprint}-red-phase.log`,
      `evidence/sprint-${sprint}-coverage.json`,
    ],
    '2b': [...IMPLEMENTATION_HINTS, `evidence/sprint-${sprint}-green-phase.log`],
    '2c': [...IMPLEMENTATION_HINTS, `evidence/sprint-${sprint}-green-phase.log`],
    '3': [
      `contracts/sprint-${sprint}.md`,
      `reviews/sprint-${sprint}/input/`,
      `reviews/sprint-${sprint}/output/`,
    ],
    '5': [
      'verification/',
      'verification/verification-report.md',
      'verification/security-report.md',
      'verification/purity-audit.md',
    ],
    '6': [
      `reviews/sprint-${sprint}/output/`,
      'verification/verification-report.md',
      'verification/security-report.md',
      'verification/purity-audit.md',
    ],
    complete: [
      'verification/verification-report.md',
      'verification/security-report.md',
      'verification/purity-audit.md',
    ],
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

run('vcsdd-auto-commit', async (payload) => {
  // Auto-commit is disabled by default - must opt in explicitly
  if (!process.env.VCSDD_AUTO_COMMIT || process.env.VCSDD_AUTO_COMMIT.toLowerCase() !== 'true') {
    return { blocked: false };
  }

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

    // Check if this is a phase completion event (phase changed since last commit)
    const lastCommitPhaseFile = path.join(vcsddRoot, '.last-commit-phase');
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
    const vcsddRelative = vcsddRoot.replace(process.cwd() + '/', '');
    const hints = phaseArtifactHints(state, activeFeature, vcsddRelative);
    const parsedDirtyFiles = dirtyFiles.map(parsePorcelainPath).filter(Boolean);
    const isImplementationPath = (filePath) => (
      /^(src|tests?|lib|app|core|__tests__)\//.test(filePath) ||
      /^(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|Cargo\.toml|Cargo\.lock|pyproject\.toml|poetry\.lock|requirements(?:-dev)?\.txt|go\.mod|go\.sum|CMakeLists\.txt)$/.test(filePath)
    );
    const stageableDirty = parsedDirtyFiles.filter(file => matchesHint(file, hints));
    const ambiguousCodeDirty = parsedDirtyFiles.filter(file => isImplementationPath(file) && !matchesHint(file, hints));
    const unrelatedDirty = parsedDirtyFiles.filter(file => !isImplementationPath(file) && !matchesHint(file, hints));

    if (ambiguousCodeDirty.length > 0 || unrelatedDirty.length > 0) {
      // Dirty worktree with files outside the current feature/phase scope - emit pending checkpoint, no-op
      appendHistory({
        event: 'auto_commit_skipped',
        featureName: activeFeature,
        reason: 'dirty changes outside current VCSDD artifact scope',
        phase: state.currentPhase,
      });
      return { blocked: false };
    }

    if (stageableDirty.length === 0) {
      appendHistory({
        event: 'auto_commit_skipped',
        featureName: activeFeature,
        reason: 'no dirty files matched current VCSDD artifact scope',
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
      `vcsdd(${state.currentPhase}): ${activeFeature} - ${phaseDesc}`,
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
      const tag = `vcsdd/${activeFeature}/phase-${state.currentPhase}`;
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
      process.stderr.write(`[vcsdd-auto-commit] Commit failed: ${commitErr.message}\n`);
    }
  } catch (err) {
    process.stderr.write(`[vcsdd-auto-commit] Error: ${err.message}\n`);
  }

  return { blocked: false };
});
