'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Constants ──
const VSDD_DIR = '.vsdd';
const INDEX_FILE = 'index.json';
const STATE_FILE = 'state.json';
const HISTORY_FILE = 'history.jsonl';
const ACTIVE_FEATURE_FILE = 'active-feature.txt';

const VALID_PHASES = new Set([
  'init', '1a', '1b', '1c',
  '2a', '2b', '2c',
  '3', '4', '5', '6', 'complete',
]);

// ── Legal Phase Transitions (adjacency map) ──
const TRANSITION_MAP = {
  'init':     ['1a'],
  '1a':       ['1b'],
  '1b':       ['1c'],
  '1c':       ['2a'],
  '2a':       ['2b'],
  '2b':       ['2c'],
  '2c':       ['3'],
  '3':        ['4'],
  '4':        ['1a', '2a', '2b', '2c', '5'],
  '5':        ['6'],
  '6':        ['complete', '3'],
  'complete': [],
};

// ── Lean Mode: Phases that can be skipped ──
const LEAN_OPTIONAL_PHASES = new Set(['1b', '2c', '5']);

// ── Gate Prerequisites ──
// Each function returns { ok: boolean, reason?: string }
const GATE_PREREQUISITES = {
  '1b': (state, featurePath) => {
    const specPath = path.join(featurePath, 'specs', 'behavioral-spec.md');
    if (!fs.existsSync(specPath)) {
      return { ok: false, reason: 'behavioral-spec.md must exist before entering phase 1b' };
    }
    return { ok: true };
  },
  '1c': (state, featurePath) => {
    const archPath = path.join(featurePath, 'specs', 'verification-architecture.md');
    if (state.mode === 'lean') return { ok: true };
    if (!fs.existsSync(archPath)) {
      return { ok: false, reason: 'verification-architecture.md must exist before entering phase 1c' };
    }
    return { ok: true };
  },
  '2a': (state) => {
    const gate = state.gates['1c'];
    if (!gate) return { ok: false, reason: 'Spec review gate (1c) must be completed before phase 2a' };
    if (gate.verdict === 'PASS' || (state.mode === 'lean' && gate.verdict === 'SKIP')) {
      return { ok: true };
    }
    return { ok: false, reason: 'Spec review gate must PASS (or SKIP in lean mode)' };
  },
  '2b': (state, featurePath) => {
    const sprint = state.sprintCount || 1;
    const redLog = path.join(featurePath, 'evidence', `sprint-${sprint}-red-phase.log`);
    if (!fs.existsSync(redLog)) {
      return { ok: false, reason: `Red phase evidence (sprint-${sprint}-red-phase.log) required` };
    }
    return { ok: true };
  },
  '2c': (state, featurePath) => {
    const sprint = state.sprintCount || 1;
    const greenLog = path.join(featurePath, 'evidence', `sprint-${sprint}-green-phase.log`);
    if (!fs.existsSync(greenLog)) {
      return { ok: false, reason: `Green phase evidence (sprint-${sprint}-green-phase.log) required` };
    }
    return { ok: true };
  },
  '5': (state) => {
    const gate = state.gates['3'];
    if (!gate) return { ok: false, reason: 'Adversary review gate (phase 3) must be completed before phase 5' };
    if (gate.verdict !== 'PASS') {
      return { ok: false, reason: 'Adversary verdict must be PASS to enter phase 5' };
    }
    return { ok: true };
  },
  '6': (state, featurePath) => {
    const reportPath = path.join(featurePath, 'verification', 'verification-report.md');
    if (state.mode === 'lean' && state.proofObligations.length === 0) return { ok: true };
    if (!fs.existsSync(reportPath)) {
      return { ok: false, reason: 'verification-report.md required for phase 6' };
    }
    const requiredProofs = state.proofObligations.filter(p => p.required);
    const failedProofs = requiredProofs.filter(p => p.status !== 'proved' && p.status !== 'skipped');
    if (failedProofs.length > 0) {
      return { ok: false, reason: `Required proof obligations not met: ${failedProofs.map(p => p.id).join(', ')}` };
    }
    return { ok: true };
  },
};

// ── Iteration Limits (safety valve) ──
const ITERATION_LIMITS = {
  '1c': 3,
  '3':  5,
  '6':  2,
};

// ── Path Helpers ──

function getVsddRoot() {
  return path.resolve(process.cwd(), VSDD_DIR);
}

function getFeaturePath(featureName) {
  return path.join(getVsddRoot(), 'features', featureName);
}

function getStatePath(featureName) {
  return path.join(getFeaturePath(featureName), STATE_FILE);
}

function getIndexPath() {
  return path.join(getVsddRoot(), INDEX_FILE);
}

function getHistoryPath() {
  return path.join(getVsddRoot(), HISTORY_FILE);
}

// ── Atomic Write ──

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
}

// ── Validation ──

function validateState(state) {
  const errors = [];

  if (!state.featureName || typeof state.featureName !== 'string') {
    errors.push('featureName is required and must be a string');
  }
  if (!['strict', 'lean'].includes(state.mode)) {
    errors.push('mode must be "strict" or "lean"');
  }
  if (!VALID_PHASES.has(state.currentPhase)) {
    errors.push(`invalid currentPhase: ${state.currentPhase}`);
  }
  if (!Array.isArray(state.phaseHistory)) {
    errors.push('phaseHistory must be an array');
  }
  if (typeof state.iterations !== 'object' || state.iterations === null) {
    errors.push('iterations must be an object');
  }
  if (!Array.isArray(state.proofObligations)) {
    errors.push('proofObligations must be an array');
  }
  if (!state.traceability || !state.traceability.epicId || !Array.isArray(state.traceability.beads)) {
    errors.push('traceability must have epicId and beads array');
  }
  if (typeof state.gates !== 'object' || state.gates === null) {
    errors.push('gates must be an object');
  }
  if (typeof state.sprintCount !== 'number' || state.sprintCount < 0) {
    errors.push('sprintCount must be a non-negative integer');
  }
  if (!state.createdAt) errors.push('createdAt is required');
  if (!state.updatedAt) errors.push('updatedAt is required');

  if (errors.length > 0) {
    throw new Error(`Invalid VSDD state: ${errors.join('; ')}`);
  }
}

function validateIndex(index) {
  const errors = [];

  if (index.version !== 1) errors.push('version must be 1');
  if (typeof index.features !== 'object' || index.features === null) {
    errors.push('features must be an object');
  }
  if (index.activeFeature !== null && typeof index.activeFeature !== 'string') {
    errors.push('activeFeature must be a string or null');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid VSDD index: ${errors.join('; ')}`);
  }
}

// ── Core State CRUD ──

function readState(featureName) {
  const statePath = getStatePath(featureName);
  if (!fs.existsSync(statePath)) {
    throw new Error(`State file not found for feature: ${featureName}`);
  }
  const raw = fs.readFileSync(statePath, 'utf8');
  const state = JSON.parse(raw);
  validateState(state);
  return state;
}

function writeState(featureName, state) {
  state.updatedAt = new Date().toISOString();
  validateState(state);
  atomicWriteJson(getStatePath(featureName), state);
}

function deleteState(featureName) {
  const featurePath = getFeaturePath(featureName);
  if (fs.existsSync(featurePath)) {
    fs.rmSync(featurePath, { recursive: true, force: true });
  }
}

// ── Phase Transitions ──

function validateTransition(currentPhase, targetPhase) {
  const allowed = TRANSITION_MAP[currentPhase];
  if (!allowed || !allowed.includes(targetPhase)) {
    return {
      ok: false,
      reason: `Illegal transition: ${currentPhase} -> ${targetPhase}. Allowed: ${(allowed || []).join(', ')}`,
    };
  }
  return { ok: true };
}

function transitionPhase(featureName, targetPhase, reason) {
  const state = readState(featureName);
  const current = state.currentPhase;

  // 1. Check transition legality
  const transResult = validateTransition(current, targetPhase);
  if (!transResult.ok) {
    throw new Error(transResult.reason);
  }

  // 2. Lean mode: skip optional phases
  if (state.mode === 'lean' && LEAN_OPTIONAL_PHASES.has(targetPhase)) {
    // Allow but don't enforce prerequisites for skippable phases
  }

  // 3. Check gate prerequisites
  const prereq = GATE_PREREQUISITES[targetPhase];
  if (prereq) {
    const featurePath = getFeaturePath(featureName);
    const prereqResult = prereq(state, featurePath);
    if (!prereqResult.ok) {
      throw new Error(`Gate prerequisite not met for phase ${targetPhase}: ${prereqResult.reason}`);
    }
  }

  // 4. Check iteration limits (safety valve)
  const iterCount = (state.iterations[targetPhase] || 0) + 1;
  const limit = ITERATION_LIMITS[targetPhase];
  if (limit && iterCount > limit) {
    writeEscalation(featureName, {
      phase: targetPhase,
      iteration: iterCount,
      limit,
      message: `Iteration limit (${limit}) exceeded for phase ${targetPhase}. Human review required.`,
    });
    throw new Error(
      `Iteration limit exceeded for phase ${targetPhase} (${iterCount}/${limit}). Escalation written to escalations/.`
    );
  }

  // 5. Apply transition
  state.currentPhase = targetPhase;
  state.iterations[targetPhase] = iterCount;
  state.phaseHistory.push({
    from: current,
    to: targetPhase,
    timestamp: new Date().toISOString(),
    reason: reason || undefined,
    sprint: state.sprintCount || undefined,
  });

  writeState(featureName, state);
  appendHistory({
    event: 'phase_transition',
    featureName,
    from: current,
    to: targetPhase,
    iteration: iterCount,
    phase: targetPhase,
  });

  return state;
}

// ── Index CRUD ──

function readIndex() {
  const indexPath = getIndexPath();
  if (!fs.existsSync(indexPath)) {
    const defaultIndex = { version: 1, features: {}, activeFeature: null };
    atomicWriteJson(indexPath, defaultIndex);
    return defaultIndex;
  }
  const raw = fs.readFileSync(indexPath, 'utf8');
  const index = JSON.parse(raw);
  validateIndex(index);
  return index;
}

function writeIndex(index) {
  validateIndex(index);
  atomicWriteJson(getIndexPath(), index);
}

function getActiveFeature() {
  const index = readIndex();
  return index.activeFeature;
}

function setActiveFeature(featureName) {
  const index = readIndex();
  if (featureName !== null && !index.features[featureName]) {
    throw new Error(`Feature not found in index: ${featureName}`);
  }
  index.activeFeature = featureName;
  writeIndex(index);
}

// ── History ──

function appendHistory(event) {
  const historyPath = getHistoryPath();
  const dir = path.dirname(historyPath);
  fs.mkdirSync(dir, { recursive: true });

  const entry = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  fs.appendFileSync(historyPath, JSON.stringify(entry) + '\n', 'utf8');
}

// ── Escalation ──

function writeEscalation(featureName, escalation) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const escalationDir = path.join(getFeaturePath(featureName), 'escalations');
  fs.mkdirSync(escalationDir, { recursive: true });

  const content = `# Escalation: Phase ${escalation.phase}\n\n` +
    `**Timestamp**: ${new Date().toISOString()}\n` +
    `**Phase**: ${escalation.phase}\n` +
    `**Iteration**: ${escalation.iteration}/${escalation.limit}\n\n` +
    `## Reason\n\n${escalation.message}\n\n` +
    `## Action Required\n\nHuman review is required to proceed. Options:\n` +
    `1. Approve continuing beyond the iteration limit\n` +
    `2. Manually adjust the spec/implementation\n` +
    `3. Abandon this feature pipeline\n`;

  const filePath = path.join(escalationDir, `escalation-${timestamp}.md`);
  fs.writeFileSync(filePath, content, 'utf8');

  appendHistory({
    event: 'escalation_created',
    featureName,
    phase: escalation.phase,
    iteration: escalation.iteration,
    limit: escalation.limit,
  });
}

// ── Feature Initialization ──

function initFeature(featureName, mode = 'lean') {
  if (!featureName || typeof featureName !== 'string') {
    throw new Error('featureName is required');
  }
  if (!['strict', 'lean'].includes(mode)) {
    throw new Error('mode must be "strict" or "lean"');
  }

  const featurePath = getFeaturePath(featureName);
  if (fs.existsSync(path.join(featurePath, STATE_FILE))) {
    throw new Error(`Feature already exists: ${featureName}`);
  }

  // Create directory tree
  const dirs = [
    'specs',
    'contracts',
    'reviews',
    'evidence',
    'verification/proof-harnesses',
    'verification/fuzz-results',
    'verification/mutation-results',
    'escalations',
  ];
  for (const dir of dirs) {
    fs.mkdirSync(path.join(featurePath, dir), { recursive: true });
  }

  const now = new Date().toISOString();
  const timestamp = Date.now();

  // Create initial state
  const state = {
    featureName,
    mode,
    currentPhase: 'init',
    phaseHistory: [],
    iterations: {},
    proofObligations: [],
    traceability: {
      epicId: `VSDD-${featureName}-${timestamp}`,
      beads: [],
    },
    gates: {},
    sprintCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  atomicWriteJson(getStatePath(featureName), state);

  // Update index
  const index = readIndex();
  index.features[featureName] = {
    status: 'active',
    createdAt: now,
    mode,
    currentPhase: 'init',
    updatedAt: now,
  };
  index.activeFeature = featureName;
  writeIndex(index);

  // History
  appendHistory({
    event: 'feature_created',
    featureName,
    mode,
  });

  return state;
}

// ── Gate Recording ──

function recordGate(featureName, phase, verdict, reviewedBy, details) {
  const state = readState(featureName);
  state.gates[phase] = {
    verdict,
    timestamp: new Date().toISOString(),
    reviewedBy: reviewedBy || undefined,
    details: details || undefined,
  };
  writeState(featureName, state);

  appendHistory({
    event: 'gate_recorded',
    featureName,
    phase,
    verdict,
    reviewedBy,
  });

  return state;
}

// ── Sprint Management ──

function startSprint(featureName) {
  const state = readState(featureName);
  state.sprintCount += 1;
  writeState(featureName, state);

  appendHistory({
    event: 'sprint_started',
    featureName,
    sprintNumber: state.sprintCount,
  });

  return state;
}

// ── Exports ──

module.exports = {
  // Constants
  VSDD_DIR,
  VALID_PHASES,
  TRANSITION_MAP,
  LEAN_OPTIONAL_PHASES,
  ITERATION_LIMITS,

  // Path helpers
  getVsddRoot,
  getFeaturePath,
  getStatePath,
  getIndexPath,
  getHistoryPath,

  // State CRUD
  readState,
  writeState,
  deleteState,

  // Phase transitions
  validateTransition,
  transitionPhase,

  // Index CRUD
  readIndex,
  writeIndex,
  getActiveFeature,
  setActiveFeature,

  // History
  appendHistory,

  // Escalation
  writeEscalation,

  // Feature lifecycle
  initFeature,

  // Gate recording
  recordGate,

  // Sprint management
  startSprint,
};
