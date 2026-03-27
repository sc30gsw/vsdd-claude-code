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

const VALID_LANGUAGES = new Set(['rust', 'python', 'typescript', 'go', 'cpp']);

// ── Strict mode: full linear ceremony (PLAN.md) ──
const STRICT_TRANSITION_MAP = {
  'init':     ['1a'],
  '1a':       ['1b'],
  '1b':       ['1c'],
  '1c':       ['2a'],
  '2a':       ['2b'],
  '2b':       ['2c'],
  '2c':       ['3'],
  '3':        ['4', '5'],
  '4':        ['1a', '2a', '2b', '2c', '5'],
  '5':        ['6'],
  '6':        ['complete', '3'],
  'complete': [],
};

/** @deprecated Use getAllowedTransitions(state) — kept for backward compatibility */
const TRANSITION_MAP = STRICT_TRANSITION_MAP;

// ── Lean Mode: phases that may be skipped via alternate transitions ──
const LEAN_OPTIONAL_PHASES = new Set(['1b', '2c', '5']);

/**
 * Allowed next phases from currentPhase, mode-aware.
 * @param {object} state full state (uses currentPhase, mode, gates, proofObligations)
 * @returns {string[]}
 */
function getAllowedTransitions(state) {
  const current = state.currentPhase;
  const mode = state.mode;

  if (mode === 'strict') {
    return [...(STRICT_TRANSITION_MAP[current] || [])];
  }

  // Lean: abbreviated path 1a -> 1c (skip 1b), 2b -> 3 (skip 2c), 3 -> 6 when no required proofs
  const out = new Set();
  switch (current) {
    case 'init':
      out.add('1a');
      break;
    case '1a':
      out.add('1b');
      out.add('1c');
      break;
    case '1b':
      out.add('1c');
      break;
    case '1c':
      out.add('2a');
      break;
    case '2a':
      out.add('2b');
      break;
    case '2b':
      out.add('2c');
      out.add('3');
      break;
    case '2c':
      out.add('3');
      break;
    case '3':
      out.add('4');
      {
        const g3 = state.gates && state.gates['3'];
        if (g3 && g3.verdict === 'PASS') {
          out.add('5');
          const required = (state.proofObligations || []).filter(p => p.required);
          if (required.length === 0) {
            out.add('6');
          }
        }
      }
      break;
    case '4':
      out.add('1a');
      out.add('2a');
      out.add('2b');
      out.add('2c');
      out.add('5');
      break;
    case '5':
      out.add('6');
      break;
    case '6':
      out.add('complete');
      out.add('3');
      break;
    case 'complete':
      break;
    default:
      break;
  }
  return [...out];
}

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
    const specPath = path.join(featurePath, 'specs', 'behavioral-spec.md');
    if (!fs.existsSync(specPath)) {
      return { ok: false, reason: 'behavioral-spec.md must exist before entering phase 1c' };
    }
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

    if (state.mode === 'strict') {
      if (gate.adversaryVerdict !== 'PASS') {
        return { ok: false, reason: 'Strict mode requires an adversary PASS for phase 1c before phase 2a' };
      }
      if (gate.humanApproved !== true) {
        return { ok: false, reason: 'Strict mode requires explicit human approval for phase 1c before phase 2a' };
      }
      return { ok: true };
    }

    if (gate.verdict === 'PASS' || gate.verdict === 'SKIP') {
      return { ok: true };
    }
    return { ok: false, reason: 'Spec review gate must PASS (or SKIP in lean mode)' };
  },
  '2b': (state, featurePath) => {
    if (!state.sprintCount || state.sprintCount < 1) {
      return { ok: false, reason: 'No sprint started yet. Run /vsdd-tdd to start sprint 1 and generate red phase evidence.' };
    }
    const sprint = state.sprintCount;
    const redLog = path.join(featurePath, 'evidence', `sprint-${sprint}-red-phase.log`);
    if (!fs.existsSync(redLog)) {
      return { ok: false, reason: `Red phase evidence (sprint-${sprint}-red-phase.log) required` };
    }

    const freshness = validateEvidenceLogFreshness(
      redLog,
      state,
      '2a',
      `Red phase evidence (sprint-${sprint}-red-phase.log)`
    );
    if (!freshness.ok) {
      return freshness;
    }

    const contentCheck = validateEvidenceLogContent(
      redLog,
      /fail(?:ed|ing)?|error|not ok\b/i,
      `Red phase evidence (sprint-${sprint}-red-phase.log)`
    );
    if (!contentCheck.ok) {
      return contentCheck;
    }

    return { ok: true };
  },
  '2c': (state, featurePath) => {
    if (!state.sprintCount || state.sprintCount < 1) {
      return { ok: false, reason: 'No sprint started yet. Run /vsdd-tdd to start sprint 1.' };
    }
    const sprint = state.sprintCount;
    const greenLog = path.join(featurePath, 'evidence', `sprint-${sprint}-green-phase.log`);
    if (!fs.existsSync(greenLog)) {
      return { ok: false, reason: `Green phase evidence (sprint-${sprint}-green-phase.log) required` };
    }

    const freshness = validateEvidenceLogFreshness(
      greenLog,
      state,
      '2b',
      `Green phase evidence (sprint-${sprint}-green-phase.log)`
    );
    if (!freshness.ok) {
      return freshness;
    }

    const contentCheck = validateEvidenceLogContent(
      greenLog,
      /passing|passed|ok\b/i,
      `Green phase evidence (sprint-${sprint}-green-phase.log)`
    );
    if (!contentCheck.ok) {
      return contentCheck;
    }

    return { ok: true };
  },
  '3': (state, featurePath) => {
    if (!state.sprintCount || state.sprintCount < 1) {
      return { ok: false, reason: 'No sprint started yet. Complete phase 2b first.' };
    }
    const sprint = state.sprintCount;
    const greenLog = path.join(featurePath, 'evidence', `sprint-${sprint}-green-phase.log`);
    if (!fs.existsSync(greenLog)) {
      return { ok: false, reason: `Green phase evidence (sprint-${sprint}-green-phase.log) required before adversarial review (phase 3)` };
    }

    const freshnessPhase = state.currentPhase === '2c' ? '2c' : '2b';
    const freshness = validateEvidenceLogFreshness(
      greenLog,
      state,
      freshnessPhase,
      `Green phase evidence (sprint-${sprint}-green-phase.log)`
    );
    if (!freshness.ok) {
      return freshness;
    }

    const contentCheck = validateEvidenceLogContent(
      greenLog,
      /passing|passed|ok\b/i,
      `Green phase log (sprint-${sprint}-green-phase.log)`
    );
    if (!contentCheck.ok) {
      return { ok: false, reason: `Green phase log (sprint-${sprint}-green-phase.log) does not contain a passing marker. Ensure all tests pass before entering phase 3.` };
    }
    if (state.mode === 'strict') {
      return validateApprovedSprintContract(state.featureName, sprint);
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
    const requiredProofs = (state.proofObligations || []).filter(p => p.required);
    if (state.mode === 'lean' && requiredProofs.length === 0) {
      return { ok: true };
    }
    if (!fs.existsSync(reportPath)) {
      return { ok: false, reason: 'verification-report.md required for phase 6' };
    }
    const failedProofs = requiredProofs.filter(p => p.status !== 'proved' && p.status !== 'skipped');
    if (failedProofs.length > 0) {
      return { ok: false, reason: `Required proof obligations not met: ${failedProofs.map(p => p.id).join(', ')}` };
    }
    if (state.mode === 'strict' && state.sprintCount > 0) {
      return validateCriteriaCoverage(state.featureName, state.sprintCount);
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

function getActiveFeaturePath() {
  return path.join(getVsddRoot(), ACTIVE_FEATURE_FILE);
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

function atomicWriteText(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

function syncActiveFeatureFile(featureName) {
  const activePath = getActiveFeaturePath();
  if (featureName == null || featureName === '') {
    if (fs.existsSync(activePath)) {
      fs.rmSync(activePath, { force: true });
    }
    return;
  }
  atomicWriteText(activePath, `${featureName}\n`);
}

function readActiveFeatureFile() {
  const activePath = getActiveFeaturePath();
  if (!fs.existsSync(activePath)) {
    return null;
  }
  const value = fs.readFileSync(activePath, 'utf8').trim();
  return value || null;
}

function getSprintContractPath(featureName, sprintNumber) {
  return path.join(getFeaturePath(featureName), 'contracts', `sprint-${sprintNumber}.md`);
}

function hasSprintCriteria(content) {
  return extractContractCriteriaIds(content).length > 0;
}

function extractContractCriteriaIds(content) {
  const ids = new Set();

  for (const match of content.matchAll(/^###\s+(CRIT-\d{3,})\b/mg)) {
    ids.add(match[1]);
  }

  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];

    for (const match of frontmatter.matchAll(/^\s*-\s*id:\s*(CRIT-\d{3,})\s*$/mg)) {
      ids.add(match[1]);
    }

    const inlineCriteriaMatch = frontmatter.match(/^\s*criteria:\s*\[([^\]]+)\]\s*$/m);
    if (inlineCriteriaMatch) {
      const inlineIds = inlineCriteriaMatch[1].match(/CRIT-\d{3,}/g) || [];
      for (const id of inlineIds) {
        ids.add(id);
      }
    }
  }

  return [...ids];
}

function parseMarkdownFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const frontmatter = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');
    frontmatter[key] = value;
  }
  return frontmatter;
}

function validateApprovedSprintContract(featureName, sprintNumber) {
  const contractPath = getSprintContractPath(featureName, sprintNumber);
  if (!fs.existsSync(contractPath)) {
    return { ok: false, reason: `Approved sprint contract required: contracts/sprint-${sprintNumber}.md` };
  }

  const content = fs.readFileSync(contractPath, 'utf8');
  if (!hasSprintCriteria(content)) {
    return { ok: false, reason: `Sprint contract sprint-${sprintNumber}.md must define at least one CRIT-XXX criterion` };
  }

  const frontmatter = parseMarkdownFrontmatter(content);
  if ((frontmatter.status || '').toLowerCase() !== 'approved') {
    return { ok: false, reason: `Sprint contract sprint-${sprintNumber}.md must have status: approved before Phase 3` };
  }

  return { ok: true, contractPath };
}

function getLatestPhaseTimestamp(state, phase) {
  for (let i = state.phaseHistory.length - 1; i >= 0; i -= 1) {
    const entry = state.phaseHistory[i];
    if (entry.to === phase && entry.timestamp) {
      const ts = Date.parse(entry.timestamp);
      if (!Number.isNaN(ts)) {
        return ts;
      }
    }
  }
  return null;
}

function validateEvidenceLogFreshness(filePath, state, phase, description) {
  const phaseTimestamp = getLatestPhaseTimestamp(state, phase);
  if (phaseTimestamp == null) {
    return { ok: false, reason: `${description} requires a recorded transition into phase ${phase}` };
  }

  const stats = fs.statSync(filePath);
  if (stats.mtimeMs < phaseTimestamp) {
    return {
      ok: false,
      reason: `${description} must be recorded after entering phase ${phase}`,
    };
  }

  return { ok: true };
}

function validateEvidenceLogContent(filePath, pattern, description) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (!pattern.test(content)) {
    return { ok: false, reason: `${description} does not contain the required marker` };
  }
  return { ok: true };
}

function validateCriteriaCoverage(featureName, sprintNumber) {
  const contractCheck = validateApprovedSprintContract(featureName, sprintNumber);
  if (!contractCheck.ok) {
    return contractCheck;
  }

  const verdictPath = path.join(getFeaturePath(featureName), 'reviews', `sprint-${sprintNumber}`, 'output', 'verdict.json');
  if (!fs.existsSync(verdictPath)) {
    return { ok: false, reason: `Review verdict required for sprint ${sprintNumber}: reviews/sprint-${sprintNumber}/output/verdict.json` };
  }

  const verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
  if (!verdict.convergenceSignals || verdict.convergenceSignals.allCriteriaEvaluated !== true) {
    return { ok: false, reason: `Sprint ${sprintNumber} verdict must set convergenceSignals.allCriteriaEvaluated=true before Phase 6` };
  }

  return { ok: true, verdictPath };
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

  if (state.language !== undefined && state.language !== null) {
    if (typeof state.language !== 'string' || !VALID_LANGUAGES.has(state.language)) {
      errors.push('language must be one of: rust, python, typescript, go, cpp, or null/omitted');
    }
  }

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
  try {
    const index = readIndex();
    if (index.activeFeature === featureName) {
      index.activeFeature = null;
      writeIndex(index);
    }
  } catch (_e) {
    syncActiveFeatureFile(null);
  }
}

// ── Phase Transitions ──

/**
 * @param {object} state full feature state (must include currentPhase, mode, gates, proofObligations)
 * @param {string} targetPhase
 */
function validateTransition(state, targetPhase) {
  const currentPhase = state.currentPhase;
  const allowed = getAllowedTransitions(state);
  if (!allowed.includes(targetPhase)) {
    return {
      ok: false,
      reason: `Illegal transition: ${currentPhase} -> ${targetPhase}. Allowed: ${allowed.join(', ') || '(none)'}`,
    };
  }
  return { ok: true };
}

function transitionPhase(featureName, targetPhase, reason) {
  const state = readState(featureName);
  const current = state.currentPhase;
  let startedSprint = false;

  // 1. Check transition legality (mode-aware)
  const transResult = validateTransition(state, targetPhase);
  if (!transResult.ok) {
    throw new Error(transResult.reason);
  }

  // 1b. Phase 3 -> 5 or 6: adversary must have recorded PASS
  if (current === '3' && (targetPhase === '5' || targetPhase === '6')) {
    const g3 = state.gates['3'];
    if (!g3 || g3.verdict !== 'PASS') {
      throw new Error('Adversary gate (phase 3) must be PASS before entering phase 5 or 6');
    }
  }
  if (current === '3' && targetPhase === '6') {
    if (state.mode !== 'lean') {
      throw new Error('Direct transition 3 -> 6 is only allowed in lean mode');
    }
    const required = (state.proofObligations || []).filter(p => p.required);
    if (required.length > 0) {
      throw new Error('Direct 3 -> 6 requires zero required proof obligations; use phase 5 first');
    }
  }

  // 2. Lean mode: optional phases — prerequisites still enforced below unless waived in GATE_PREREQUISITES

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

  if (targetPhase === '2a' && (current === '1c' || current === '4')) {
    state.sprintCount += 1;
    startedSprint = true;
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

  // Sync index.json so currentPhase stays consistent without requiring session-persist hook
  try {
    const index = readIndex();
    if (index.features[featureName]) {
      index.features[featureName].currentPhase = targetPhase;
      index.features[featureName].updatedAt = state.updatedAt;
      writeIndex(index);
    }
  } catch (_e) {
    // Non-fatal: state.json is the source of truth; index is a convenience cache
  }

  appendHistory({
    event: 'phase_transition',
    featureName,
    from: current,
    to: targetPhase,
    iteration: iterCount,
    phase: targetPhase,
  });

  if (startedSprint) {
    appendHistory({
      event: 'sprint_started',
      featureName,
      sprintNumber: state.sprintCount,
      phase: targetPhase,
    });
  }

  return state;
}

// ── Index CRUD ──

function readIndex() {
  const indexPath = getIndexPath();
  if (!fs.existsSync(indexPath)) {
    const defaultIndex = { version: 1, features: {}, activeFeature: readActiveFeatureFile() };
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
  syncActiveFeatureFile(index.activeFeature);
}

function getActiveFeature() {
  const index = readIndex();
  return index.activeFeature || readActiveFeatureFile();
}

/**
 * Language profile for verification (from state.json, else denormalized index).
 * @param {string} featureName
 * @returns {string|null} e.g. 'rust' | 'typescript' | null
 */
function getLanguageForFeature(featureName) {
  const state = readState(featureName);
  if (state.language && VALID_LANGUAGES.has(state.language)) {
    return state.language;
  }
  const index = readIndex();
  const entry = index.features[featureName];
  if (entry && entry.language && VALID_LANGUAGES.has(entry.language)) {
    return entry.language;
  }
  return null;
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

function initFeature(featureName, mode = 'lean', language = null) {
  if (!featureName || typeof featureName !== 'string') {
    throw new Error('featureName is required');
  }
  if (!['strict', 'lean'].includes(mode)) {
    throw new Error('mode must be "strict" or "lean"');
  }

  let languageNorm = null;
  if (language != null && language !== '') {
    const lang = String(language).toLowerCase();
    if (!VALID_LANGUAGES.has(lang)) {
      throw new Error(`language must be one of: ${[...VALID_LANGUAGES].join(', ')}`);
    }
    languageNorm = lang;
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
    ...(languageNorm != null ? { language: languageNorm } : {}),
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

  validateState(state);
  atomicWriteJson(getStatePath(featureName), state);

  // Update index
  const index = readIndex();
  index.features[featureName] = {
    status: 'active',
    createdAt: now,
    mode,
    ...(languageNorm != null ? { language: languageNorm } : {}),
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
    ...(languageNorm != null ? { language: languageNorm } : {}),
  });

  return state;
}

// ── Gate Recording ──

function recordGate(featureName, phase, verdict, reviewedBy, details) {
  const state = readState(featureName);
  const timestamp = new Date().toISOString();
  const existing = state.gates[phase] || {};
  const nextGate = {
    ...existing,
    verdict,
    timestamp,
    reviewedBy: reviewedBy || existing.reviewedBy,
    details: details !== undefined ? details : existing.details,
  };

  if (phase === '1c') {
    if (reviewedBy === 'adversary') {
      nextGate.adversaryVerdict = verdict;
      nextGate.adversaryReviewedAt = timestamp;
    }
    if (reviewedBy === 'human') {
      nextGate.humanVerdict = verdict;
      nextGate.humanApproved = verdict === 'PASS';
      nextGate.humanApprovedAt = verdict === 'PASS' ? timestamp : undefined;
    }
  }

  state.gates[phase] = nextGate;
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
  VALID_LANGUAGES,
  STRICT_TRANSITION_MAP,
  TRANSITION_MAP,
  LEAN_OPTIONAL_PHASES,
  ITERATION_LIMITS,
  getAllowedTransitions,

  // Path helpers
  getVsddRoot,
  getFeaturePath,
  getStatePath,
  getIndexPath,
  getActiveFeaturePath,
  getHistoryPath,
  getSprintContractPath,

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
  getLanguageForFeature,
  setActiveFeature,
  readActiveFeatureFile,
  syncActiveFeatureFile,

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
  validateApprovedSprintContract,
  validateCriteriaCoverage,
};
