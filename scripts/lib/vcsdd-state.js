'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { assertValidDocument } = require('./vcsdd-schema');

// ── Constants ──
const VCSDD_DIR = '.vcsdd';
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
const FEATURE_NAME_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const RED_EVIDENCE_PATTERNS = [
  {
    pattern: /new[-\s]?feature[-\s]?tests:\s*(fail|failed|failing)\b|new tests.*fail|tests failing as expected|coverage[-\s]?retrofit:\s*(true|yes|1)\b/i,
    description: 'new feature tests failing marker (or coverage-retrofit flag for sprints that add tests to existing code)',
  },
  {
    pattern: /regression[-\s]?baseline:\s*(pass|passed|passing|green)\b|regression baseline.*pass|regression suite.*pass|existing tests.*pass/i,
    description: 'regression baseline pass marker',
  },
];
const GREEN_EVIDENCE_PATTERNS = [
  {
    pattern: /target[-\s]?feature[-\s]?tests:\s*(pass|passed|passing|green)\b|all tests passing|target feature tests.*pass/i,
    description: 'target feature pass marker',
  },
  {
    pattern: /regression[-\s]?baseline:\s*(pass|passed|passing|green)\b|regression baseline.*pass|regression suite.*pass|existing tests.*pass/i,
    description: 'regression baseline pass marker',
  },
];
const FEEDBACK_ROUTE_ORDER = Object.freeze(['1a', '1b', '2a', '2b', '2c', '5']);

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
  '4':        ['1a', '1b', '2a', '2b', '2c', '5'],
  '5':        ['6'],
  '6':        ['complete', '3'],
  // complete → 1a: start a new sprint cycle from spec crystallization
  // complete → 3:  re-enter adversarial review without a full spec rewrite
  'complete': ['1a', '3'],
};

/** @deprecated Use getAllowedTransitions(state) — kept for backward compatibility */
const TRANSITION_MAP = STRICT_TRANSITION_MAP;

/**
 * Allowed next phases from currentPhase, mode-aware.
 * @param {object} state full state (uses currentPhase, mode, gates, proofObligations)
 * @returns {string[]}
 */
function getAllowedTransitions(state) {
  const current = state.currentPhase;
  return [...(STRICT_TRANSITION_MAP[current] || [])];
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
    if (!fs.existsSync(archPath)) {
      return { ok: false, reason: 'verification-architecture.md must exist before entering phase 1c' };
    }
    return { ok: true };
  },
  '2a': (state, featurePath) => {
    const gate = state.gates['1c'];
    if (!gate) return { ok: false, reason: 'Spec review gate (1c) must be completed before phase 2a' };

    if (state.mode === 'strict') {
      if (gate.adversaryVerdict !== 'PASS') {
        return { ok: false, reason: 'Strict mode requires an adversary PASS for phase 1c before phase 2a' };
      }
      if (gate.humanApproved !== true) {
        return { ok: false, reason: 'Strict mode requires explicit human approval for phase 1c before phase 2a' };
      }
    } else if (gate.verdict !== 'PASS') {
      return { ok: false, reason: 'Spec review gate must PASS before phase 2a' };
    }

    // Coherence validation is opt-in.
    // If any spec frontmatter declares coherence metadata, or coherence.json already
    // exists for this feature, refresh from frontmatter first so the CEG is fresh.
    // Dangling refs, cycles, invalid frontmatter, and runtime failures block phase 2a.
    // A corrupted coherence.json is backed up and rebuilt from frontmatter.
    try {
      const {
        refreshAndValidateCoherence,
      } = require('./vcsdd-coherence');
      const coherenceCheck = refreshAndValidateCoherence(state.featureName);
      if (coherenceCheck.active) {
        if (coherenceCheck.recoveredFromCorruption) {
          appendHistory({
            event: 'coherence_recovered',
            featureName: state.featureName,
            phase: '2a',
            message: 'Recovered coherence.json from current frontmatter after corruption; backup saved as coherence.json.bak',
          });
        }
        if (!coherenceCheck.validation.ok) {
          return { ok: false, reason: `Coherence validation failed: ${coherenceCheck.validation.reason}` };
        }
      }
    } catch (err) {
      appendHistory({
        event:       'coherence_check_error',
        featureName: state.featureName,
        phase:       '2a',
        error:       err.message,
      });
      return { ok: false, reason: `Coherence module error: ${err.message}` };
    }

    return { ok: true };
  },
  '2b': (state, featurePath) => {
    if (!state.sprintCount || state.sprintCount < 1) {
      return { ok: false, reason: 'No sprint started yet. Run /vcsdd-tdd to start sprint 1 and generate red phase evidence.' };
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

    const contentCheck = validateEvidenceLogMarkers(
      redLog,
      RED_EVIDENCE_PATTERNS,
      `Red phase evidence (sprint-${sprint}-red-phase.log)`
    );
    if (!contentCheck.ok) {
      return contentCheck;
    }

    return { ok: true };
  },
  '2c': (state, featurePath) => {
    if (!state.sprintCount || state.sprintCount < 1) {
      return { ok: false, reason: 'No sprint started yet. Run /vcsdd-tdd to start sprint 1.' };
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

    const contentCheck = validateEvidenceLogMarkers(
      greenLog,
      GREEN_EVIDENCE_PATTERNS,
      `Green phase evidence (sprint-${sprint}-green-phase.log)`
    );
    if (!contentCheck.ok) {
      return contentCheck;
    }

    return { ok: true };
  },
  // Note: phase 3 is re-entrant from phase 6 (convergence loop). In that case
  // freshnessPhase falls back to '2b', which is satisfied because the current
  // sprint's green-phase log was already written after the last phase 2b entry.
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

    const contentCheck = validateEvidenceLogMarkers(
      greenLog,
      GREEN_EVIDENCE_PATTERNS,
      `Green phase log (sprint-${sprint}-green-phase.log)`
    );
    if (!contentCheck.ok) {
      return {
        ok: false,
        reason: `Green phase log (sprint-${sprint}-green-phase.log) must prove both target feature tests and the regression baseline passed before entering phase 3.`,
      };
    }
    if (state.mode === 'strict') {
      return validateSprintContractReview(state.featureName, sprint);
    }
    return { ok: true };
  },
  '4': (state) => validateFeedbackRoutingTarget(state.featureName, state.sprintCount),
  '5': (state) => {
    const gate = state.gates['3'];
    if (!gate) return { ok: false, reason: 'Adversary review gate (phase 3) must be completed before phase 5' };
    if (gate.verdict === 'PASS') {
      return { ok: true };
    }
    if (state.currentPhase === '4' && gate.verdict === 'FAIL') {
      return validateFeedbackRoutingTarget(state.featureName, state.sprintCount, '5');
    }
    return { ok: false, reason: 'Adversary verdict must be PASS to enter phase 5 unless the active feedback route for the current sprint targets phase 5' };
  },
  '6': (state, featurePath) => {
    const artifactCheck = validateFormalHardeningArtifacts(featurePath, state);
    const requiredProofs = (state.proofObligations || []).filter(p => p.required);
    if (!artifactCheck.ok) {
      return artifactCheck;
    }
    const failedProofs = requiredProofs.filter(p => p.status !== 'proved');
    if (failedProofs.length > 0) {
      return { ok: false, reason: `Required proof obligations not met: ${failedProofs.map(p => p.id).join(', ')}` };
    }
    if (state.sprintCount > 0) {
      const contractPath = getSprintContractPath(state.featureName, state.sprintCount);
      if (state.mode === 'strict' || fs.existsSync(contractPath)) {
        return validateCriteriaCoverage(state.featureName, state.sprintCount);
      }
    }
    return { ok: true };
  },
  'complete': (state) => validateConvergenceForCompletion(state.featureName, state),
};

// ── Iteration Limits (safety valve) ──
const ITERATION_LIMITS = Object.freeze({
  default: Object.freeze({
    '1c': 3,
    '6': 2,
    'contract-review': 2,
  }),
  strict: Object.freeze({
    '3': 5,
  }),
  lean: Object.freeze({
    '3': 3,
  }),
});

function getIterationLimit(stateOrMode, phase) {
  const mode = typeof stateOrMode === 'string'
    ? stateOrMode
    : (stateOrMode && stateOrMode.mode) || 'lean';

  if (!phase) {
    return null;
  }

  return ITERATION_LIMITS[mode]?.[phase]
    ?? ITERATION_LIMITS.default[phase]
    ?? null;
}

// ── Path Helpers ──

function getVcsddRoot() {
  return path.resolve(process.cwd(), VCSDD_DIR);
}

function getFeaturePath(featureName) {
  return path.join(getVcsddRoot(), 'features', featureName);
}

function getStatePath(featureName) {
  return path.join(getFeaturePath(featureName), STATE_FILE);
}

function getIndexPath() {
  return path.join(getVcsddRoot(), INDEX_FILE);
}

function getActiveFeaturePath() {
  return path.join(getVcsddRoot(), ACTIVE_FEATURE_FILE);
}

function getHistoryPath() {
  return path.join(getVcsddRoot(), HISTORY_FILE);
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

function getSprintContractReviewPath(featureName, sprintNumber) {
  return path.join(
    getFeaturePath(featureName),
    'reviews',
    'contracts',
    `sprint-${sprintNumber}`,
    'output',
    'verdict.json'
  );
}

function normalizeSprintContractForReview(content) {
  const normalizedContent = String(content || '').replace(/\r\n/g, '\n');
  const frontmatterMatch = normalizedContent.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!frontmatterMatch) {
    return normalizedContent;
  }

  const frontmatterBody = frontmatterMatch[1]
    .split('\n')
    .filter((line) => !/^\s*status:\s*/.test(line))
    .map((line) => line.trimEnd())
    .join('\n');
  const rest = normalizedContent.slice(frontmatterMatch[0].length);
  return `---\n${frontmatterBody}\n---\n${rest}`;
}

function computeContentDigest(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

function computeSprintContractReviewDigest(content) {
  return computeContentDigest(normalizeSprintContractForReview(content));
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

function parseStructuredFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const result = {};
  let currentArrayKey = null;
  let currentArrayItem = null;

  for (const rawLine of match[1].split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) {
      continue;
    }

    const topLevelMatch = rawLine.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (topLevelMatch && !rawLine.startsWith(' ')) {
      const [, key, rawValue] = topLevelMatch;
      if (rawValue === '') {
        result[key] = [];
        currentArrayKey = key;
        currentArrayItem = null;
      } else {
        result[key] = coerceFrontmatterScalar(rawValue);
        currentArrayKey = null;
        currentArrayItem = null;
      }
      continue;
    }

    if (currentArrayKey) {
      const arrayItemMatch = rawLine.match(/^\s*-\s*([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
      if (arrayItemMatch) {
        currentArrayItem = {
          [arrayItemMatch[1]]: coerceFrontmatterScalar(arrayItemMatch[2]),
        };
        result[currentArrayKey].push(currentArrayItem);
        continue;
      }

      const nestedMatch = rawLine.match(/^\s+([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
      if (nestedMatch && currentArrayItem) {
        currentArrayItem[nestedMatch[1]] = coerceFrontmatterScalar(nestedMatch[2]);
      }
    }
  }

  return result;
}

function coerceFrontmatterScalar(rawValue) {
  const trimmed = String(rawValue || '').trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number.parseFloat(trimmed);
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function validateApprovedSprintContract(featureName, sprintNumber) {
  const contractPath = getSprintContractPath(featureName, sprintNumber);
  if (!fs.existsSync(contractPath)) {
    return { ok: false, reason: `Approved sprint contract required: contracts/sprint-${sprintNumber}.md` };
  }

  const content = fs.readFileSync(contractPath, 'utf8');
  const frontmatterObject = parseStructuredFrontmatter(content);
  try {
    assertValidDocument('contract', frontmatterObject, `sprint contract sprint-${sprintNumber}.md`);
  } catch (error) {
    return { ok: false, reason: error.message };
  }

  const frontmatter = parseMarkdownFrontmatter(content);
  if ((frontmatter.status || '').toLowerCase() !== 'approved') {
    return { ok: false, reason: `Sprint contract sprint-${sprintNumber}.md must have status: approved before Phase 3` };
  }

  if (!hasSprintCriteria(content)) {
    return { ok: false, reason: `Sprint contract sprint-${sprintNumber}.md must define at least one CRIT-XXX criterion` };
  }

  return {
    ok: true,
    contractPath,
    content,
    frontmatter: frontmatterObject,
    criteriaIds: extractContractCriteriaIds(content),
    reviewDigest: computeSprintContractReviewDigest(content),
  };
}

function validateSprintContractReview(featureName, sprintNumber) {
  const contractCheck = validateApprovedSprintContract(featureName, sprintNumber);
  if (!contractCheck.ok) {
    return contractCheck;
  }

  const verdictPath = getSprintContractReviewPath(featureName, sprintNumber);
  if (!fs.existsSync(verdictPath)) {
    return {
      ok: false,
      reason: `Contract review PASS required for sprint ${sprintNumber}: reviews/contracts/sprint-${sprintNumber}/output/verdict.json`,
    };
  }

  try {
    const verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
    assertValidDocument('grading', verdict, `contract review verdict sprint-${sprintNumber}`);
    const reviewContext = verdict.reviewContext || {};
    const expectedIteration = ((contractCheck.frontmatter && contractCheck.frontmatter.negotiationRound) || 0) + 1;
    const expectedContractPath = `contracts/sprint-${sprintNumber}.md`;

    if (reviewContext.reviewType !== 'contract') {
      return {
        ok: false,
        reason: `Contract review verdict for sprint ${sprintNumber} must declare reviewContext.reviewType="contract"`,
      };
    }
    if (reviewContext.contractPath !== expectedContractPath) {
      return {
        ok: false,
        reason: `Contract review verdict for sprint ${sprintNumber} must reference ${expectedContractPath}`,
      };
    }
    if (reviewContext.contractDigest !== contractCheck.reviewDigest) {
      return {
        ok: false,
        reason: `Contract review verdict for sprint ${sprintNumber} does not match the currently approved sprint contract content`,
      };
    }
    if (verdict.iteration !== expectedIteration) {
      return {
        ok: false,
        reason: `Contract review verdict iteration (${verdict.iteration || 'missing'}) must equal negotiationRound + 1 (${expectedIteration}) for sprint ${sprintNumber}`,
      };
    }
    const contractReviewLimit = ITERATION_LIMITS.default['contract-review'];
    if (verdict.iteration > contractReviewLimit) {
      writeEscalation(featureName, {
        phase: 'contract-review',
        iteration: verdict.iteration,
        limit: contractReviewLimit,
        message: `Contract review negotiation limit exceeded for sprint ${sprintNumber}. Human review required before Phase 3.`,
      });
      return {
        ok: false,
        reason: `Contract review negotiation limit exceeded for sprint ${sprintNumber} (${verdict.iteration}/${contractReviewLimit})`,
      };
    }
    if (verdict.overallVerdict !== 'PASS') {
      return {
        ok: false,
        reason: `Contract review PASS required for sprint ${sprintNumber} before Phase 3`,
      };
    }
    return { ok: true, verdictPath, contractPath: contractCheck.contractPath, verdict };
  } catch (error) {
    return {
      ok: false,
      reason: `Contract review verdict for sprint ${sprintNumber} is not valid JSON: ${error.message}`,
    };
  }
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
  // Allow 5 second tolerance for filesystems with coarse mtime precision (e.g. HFS+)
  if (stats.mtimeMs < phaseTimestamp - 5000) {
    return {
      ok: false,
      reason: `${description} must be recorded after entering phase ${phase}. If the file already exists, update its mtime: run \`touch <path>\` after the phase transition is recorded.`,
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

function validateEvidenceLogMarkers(filePath, checks, description) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const check of checks) {
    if (!check.pattern.test(content)) {
      return {
        ok: false,
        reason: `${description} must include a ${check.description}`,
      };
    }
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

  let verdict;
  try {
    verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
    assertValidDocument('grading', verdict, `review verdict sprint-${sprintNumber}`);
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  if (!verdict.convergenceSignals || verdict.convergenceSignals.allCriteriaEvaluated !== true) {
    return { ok: false, reason: `Sprint ${sprintNumber} verdict is missing convergenceSignals. When a feature has gone through Phase 3 more than once, add to verdict.json: "convergenceSignals": { "findingCount": <current count>, "previousFindingCount": <prior count>, "allCriteriaEvaluated": true, "evaluatedCriteria": [] }` };
  }

  const evaluatedCriteria = Array.isArray(verdict.convergenceSignals.evaluatedCriteria)
    ? verdict.convergenceSignals.evaluatedCriteria
    : [];
  if (evaluatedCriteria.length === 0) {
    return { ok: false, reason: `Sprint ${sprintNumber} verdict must enumerate convergenceSignals.evaluatedCriteria before Phase 6` };
  }

  const expectedCriteria = contractCheck.criteriaIds || [];
  const missingCriteria = expectedCriteria.filter((criterionId) => !evaluatedCriteria.includes(criterionId));
  if (missingCriteria.length > 0) {
    return {
      ok: false,
      reason: `Sprint ${sprintNumber} verdict is missing evaluated criteria: ${missingCriteria.join(', ')}`,
    };
  }

  const unexpectedCriteria = evaluatedCriteria.filter((criterionId) => !expectedCriteria.includes(criterionId));
  if (unexpectedCriteria.length > 0) {
    return {
      ok: false,
      reason: `Sprint ${sprintNumber} verdict lists criteria not present in the approved contract: ${unexpectedCriteria.join(', ')}`,
    };
  }

  return { ok: true, verdictPath };
}

function validateMarkdownArtifactSections(filePath, label, patterns) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) {
    return { ok: false, reason: `${label} must not be empty` };
  }

  for (const pattern of patterns) {
    if (!pattern.test(content)) {
      return {
        ok: false,
        reason: `${label} is missing required content that matches ${pattern.toString()}`,
      };
    }
  }

  return { ok: true };
}

function validateFormalHardeningArtifacts(featurePath, state) {
  const requiredArtifacts = [
    {
      relativePath: path.join('verification', 'verification-report.md'),
      label: 'verification-report.md',
      patterns: [
        /^# Verification Report\b/m,
        /^## Proof Obligations\b/m,
        /^## Summary\b/m,
      ],
    },
    {
      relativePath: path.join('verification', 'security-report.md'),
      label: 'security-report.md',
      patterns: [
        /^# Security Hardening Report\b/m,
        /^## Tooling\b/m,
        /^## Summary\b/m,
      ],
    },
    {
      relativePath: path.join('verification', 'purity-audit.md'),
      label: 'purity-audit.md',
      patterns: [
        /^# Purity Boundary Audit\b/m,
        /^## Declared Boundaries\b/m,
        /^## Observed Boundaries\b/m,
        /^## Summary\b/m,
      ],
    },
  ];
  const phase5Timestamp = state ? getLatestPhaseTimestamp(state, '5') : null;
  if (state && phase5Timestamp == null) {
    return { ok: false, reason: 'Formal hardening artifacts require a recorded transition into phase 5' };
  }

  for (const artifact of requiredArtifacts) {
    const artifactPath = path.join(featurePath, artifact.relativePath);
    if (!fs.existsSync(artifactPath)) {
      return {
        ok: false,
        reason: `${artifact.label} not found. Create it at: .vcsdd/features/<feature>/verification/${artifact.relativePath.replace(/\\/g, '/')} (not at project root verification/)`,
      };
    }

    const contentCheck = validateMarkdownArtifactSections(
      artifactPath,
      artifact.label,
      artifact.patterns || []
    );
    if (!contentCheck.ok) {
      return contentCheck;
    }

    if (phase5Timestamp != null) {
      const stats = fs.statSync(artifactPath);
      if (stats.mtimeMs < phase5Timestamp - 5000) {
        return {
          ok: false,
          reason: `${artifact.label} must be recorded after entering phase 5`,
        };
      }
    }
  }

  const securityResultsPath = path.join(featurePath, 'verification', 'security-results');
  if (!fs.existsSync(securityResultsPath)) {
    return {
      ok: false,
      reason: 'verification/security-results/ required for phase 6',
    };
  }

  const securityResultEntries = fs.readdirSync(securityResultsPath)
    .map((entry) => path.join(securityResultsPath, entry))
    .filter((entryPath) => fs.statSync(entryPath).isFile());
  if (securityResultEntries.length === 0) {
    return {
      ok: false,
      reason: 'verification/security-results/ must contain at least one captured output artifact for phase 6',
    };
  }
  if (phase5Timestamp != null) {
    const freshSecurityResultExists = securityResultEntries.some((entryPath) => fs.statSync(entryPath).mtimeMs >= phase5Timestamp - 5000);
    if (!freshSecurityResultExists) {
      return {
        ok: false,
        reason: 'verification/security-results/ must contain at least one captured output artifact recorded after entering phase 5',
      };
    }
  }

  return { ok: true };
}

function getSprintVerdictPath(featureName, sprintNumber) {
  return path.join(getFeaturePath(featureName), 'reviews', `sprint-${sprintNumber}`, 'output', 'verdict.json');
}

function readSprintVerdict(featureName, sprintNumber) {
  const verdictPath = getSprintVerdictPath(featureName, sprintNumber);
  if (!fs.existsSync(verdictPath)) {
    return {
      ok: false,
      reason: `Review verdict required for sprint ${sprintNumber}: reviews/sprint-${sprintNumber}/output/verdict.json`,
    };
  }

  try {
    const verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
    assertValidDocument('grading', verdict, `review verdict sprint-${sprintNumber}`);
    return { ok: true, verdict, verdictPath };
  } catch (error) {
    return {
      ok: false,
      reason: `Review verdict for sprint ${sprintNumber} is not valid JSON: ${error.message}`,
    };
  }
}

function getFindingFiles(featureName, sprintNumber) {
  const findingsDir = path.join(getFeaturePath(featureName), 'reviews', `sprint-${sprintNumber}`, 'output', 'findings');
  if (!fs.existsSync(findingsDir)) {
    return [];
  }

  return fs.readdirSync(findingsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(findingsDir, name));
}

function getAllFindingFiles(featureName) {
  const reviewsDir = path.join(getFeaturePath(featureName), 'reviews');
  if (!fs.existsSync(reviewsDir)) {
    return [];
  }

  return fs.readdirSync(reviewsDir)
    .filter((name) => /^sprint-\d+$/.test(name))
    .sort((left, right) => {
      const leftNumber = Number.parseInt(left.replace('sprint-', ''), 10);
      const rightNumber = Number.parseInt(right.replace('sprint-', ''), 10);
      return leftNumber - rightNumber;
    })
    .flatMap((sprintDir) => {
      const findingsDir = path.join(reviewsDir, sprintDir, 'output', 'findings');
      if (!fs.existsSync(findingsDir)) {
        return [];
      }

      return fs.readdirSync(findingsDir)
        .filter((name) => name.endsWith('.json'))
        .sort()
        .map((name) => path.join(findingsDir, name));
    });
}

function readFindingDocument(findingPath) {
  const finding = JSON.parse(fs.readFileSync(findingPath, 'utf8'));
  assertValidDocument('finding', finding, path.relative(process.cwd(), findingPath));
  return finding;
}

function validateFeedbackRoutingTarget(featureName, sprintNumber, targetPhase) {
  if (!Number.isInteger(sprintNumber) || sprintNumber < 1) {
    return { ok: false, reason: 'Feedback routing requires an active sprint review verdict' };
  }

  const verdictResult = readSprintVerdict(featureName, sprintNumber);
  if (!verdictResult.ok) {
    return verdictResult;
  }
  if (verdictResult.verdict.overallVerdict !== 'FAIL') {
    return { ok: false, reason: `Feedback routing requires the latest sprint verdict to be FAIL, got ${verdictResult.verdict.overallVerdict}` };
  }

  const findingPaths = getFindingFiles(featureName, sprintNumber);
  if (findingPaths.length === 0) {
    return { ok: false, reason: `Feedback routing requires at least one finding for sprint ${sprintNumber}` };
  }

  const findings = [];
  for (const findingPath of findingPaths) {
    try {
      findings.push({ findingPath, finding: readFindingDocument(findingPath) });
    } catch (error) {
      return {
        ok: false,
        reason: `Feedback routing requires valid finding JSON: ${path.relative(process.cwd(), findingPath)} (${error.message})`,
      };
    }
  }

  const routes = findings.map(({ finding }) => finding.routeToPhase);
  const earliestRoute = FEEDBACK_ROUTE_ORDER.find((phase) => routes.includes(phase));
  if (!earliestRoute) {
    return { ok: false, reason: `Feedback routing could not resolve an earliest route for sprint ${sprintNumber}` };
  }

  if (targetPhase && targetPhase !== earliestRoute) {
    const conflictingFindings = findings
      .filter(({ finding }) => finding.routeToPhase === earliestRoute)
      .map(({ finding }) => finding.findingId);
    return {
      ok: false,
      reason: `Earliest feedback route is phase ${earliestRoute}; cannot route to ${targetPhase} while findings ${conflictingFindings.join(', ')} remain open for ${earliestRoute}`,
    };
  }

  return { ok: true, earliestRoute, findingCount: findings.length };
}

function resolveEvidenceFilePath(evidencePath) {
  if (!evidencePath || typeof evidencePath !== 'string') {
    return null;
  }

  return path.isAbsolute(evidencePath)
    ? evidencePath
    : path.resolve(process.cwd(), evidencePath);
}

function parseLineRange(lineRange) {
  const match = String(lineRange || '').match(/^(\d+)-(\d+)$/);
  if (!match) {
    return null;
  }

  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2], 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    return null;
  }

  return { start, end };
}

function validateFindingSpecificity(featureName) {
  for (const findingPath of getAllFindingFiles(featureName)) {
    let finding;
    try {
      finding = readFindingDocument(findingPath);
    } catch (error) {
      return {
        ok: false,
        reason: `Finding file is not valid JSON: ${path.relative(process.cwd(), findingPath)} (${error.message})`,
      };
    }

    const evidencePath = resolveEvidenceFilePath(
      finding && finding.evidence && finding.evidence.filePath
    );
    if (!evidencePath || !fs.existsSync(evidencePath)) {
      return {
        ok: false,
        reason: `Finding specificity check failed: evidence.filePath is missing or does not exist in ${path.relative(process.cwd(), findingPath)}`,
      };
    }

    const range = parseLineRange(
      finding && finding.evidence && finding.evidence.lineRange
    );
    if (!range) {
      return {
        ok: false,
        reason: `Finding specificity check failed: evidence.lineRange is missing or invalid in ${path.relative(process.cwd(), findingPath)}`,
      };
    }

    const lineCount = fs.readFileSync(evidencePath, 'utf8').split(/\r?\n/).length;
    if (range.end > lineCount) {
      return {
        ok: false,
        reason: `Finding specificity check failed: evidence.lineRange ${finding.evidence.lineRange} exceeds file length (${lineCount} lines) in ${path.relative(process.cwd(), findingPath)}`,
      };
    }
  }

  return { ok: true };
}

function validateFindingBeadCoverage(featureName, sprintNumber, state) {
  const effectiveState = state || readState(featureName);
  const adversaryBeads = (effectiveState.traceability && effectiveState.traceability.beads
    ? effectiveState.traceability.beads
    : []
  ).filter((bead) => bead.type === 'adversary-finding');

  for (const findingPath of getAllFindingFiles(featureName)) {
    let finding;
    try {
      finding = readFindingDocument(findingPath);
    } catch (error) {
      return {
        ok: false,
        reason: `Finding bead coverage check failed: ${path.relative(process.cwd(), findingPath)} is invalid (${error.message})`,
      };
    }

    const bead = adversaryBeads.find((candidate) => candidate.externalId === finding.findingId);
    if (!bead) {
      return {
        ok: false,
        reason: `Finding bead coverage check failed: no adversary-finding bead exists for ${finding.findingId}`,
      };
    }

    const expectedPath = path.resolve(process.cwd(), findingPath).replace(/\\/g, '/');
    const beadPath = path.resolve(process.cwd(), bead.artifactPath).replace(/\\/g, '/');
    if (beadPath !== expectedPath) {
      return {
        ok: false,
        reason: `Finding bead coverage check failed: bead ${bead.beadId} for ${finding.findingId} points to ${bead.artifactPath}, expected ${path.relative(process.cwd(), findingPath)}`,
      };
    }
  }

  return { ok: true };
}

function validateConvergenceForCompletion(featureName, state) {
  if (!state.sprintCount || state.sprintCount < 1) {
    return { ok: false, reason: 'Cannot complete a feature with no sprint history' };
  }

  const hardeningArtifacts = validateFormalHardeningArtifacts(getFeaturePath(featureName), state);
  if (!hardeningArtifacts.ok) {
    return hardeningArtifacts;
  }

  const failedProofs = (state.proofObligations || [])
    .filter((proof) => proof.required)
    .filter((proof) => proof.status !== 'proved');
  if (failedProofs.length > 0) {
    return {
      ok: false,
      reason: `Required proof obligations not met: ${failedProofs.map((proof) => proof.id).join(', ')}`,
    };
  }

  if (state.mode === 'strict' && state.sprintCount > 0) {
    const criteriaCoverage = validateCriteriaCoverage(featureName, state.sprintCount);
    if (!criteriaCoverage.ok) {
      return criteriaCoverage;
    }
  }

  const verdictResult = readSprintVerdict(featureName, state.sprintCount);
  if (!verdictResult.ok) {
    return verdictResult;
  }

  const { verdict } = verdictResult;
  if (verdict.overallVerdict !== 'PASS') {
    return { ok: false, reason: 'Latest adversary verdict must be PASS before completion' };
  }

  const convergenceSignals = verdict.convergenceSignals || {};
  if (verdict.iteration > 1) {
    if (!Number.isInteger(convergenceSignals.previousFindingCount)) {
      return {
        ok: false,
        reason: 'Completion requires convergenceSignals.previousFindingCount for iterations beyond the first',
      };
    }
    if ((convergenceSignals.findingCount || 0) >= convergenceSignals.previousFindingCount) {
      return {
        ok: false,
        reason: 'Completion requires findings to decrease versus convergenceSignals.previousFindingCount on later iterations',
      };
    }
  }

  if ((convergenceSignals.findingCount || 0) !== 0) {
    return { ok: false, reason: 'Completion requires zero active findings in convergenceSignals.findingCount' };
  }

  if (Array.isArray(convergenceSignals.duplicateFindings) && convergenceSignals.duplicateFindings.length > 0) {
    return { ok: false, reason: 'Completion is blocked while duplicate findings remain in convergenceSignals.duplicateFindings' };
  }

  const findingBeadCoverage = validateFindingBeadCoverage(featureName, state.sprintCount, state);
  if (!findingBeadCoverage.ok) {
    return findingBeadCoverage;
  }

  const openFindingBeads = state.traceability.beads.filter(
    (bead) => bead.type === 'adversary-finding' && bead.status === 'open'
  );
  if (openFindingBeads.length > 0) {
    return {
      ok: false,
      reason: `Open adversary findings remain: ${openFindingBeads.map((bead) => bead.externalId || bead.beadId).join(', ')}`,
    };
  }

  return validateFindingSpecificity(featureName);
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
    throw new Error(`Invalid VCSDD state: ${errors.join('; ')}`);
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
    throw new Error(`Invalid VCSDD index: ${errors.join('; ')}`);
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
  assertValidDocument('state', state, `state for feature ${featureName}`);
  return state;
}

function writeState(featureName, state) {
  state.updatedAt = new Date().toISOString();
  validateState(state);
  assertValidDocument('state', state, `state for feature ${featureName}`);
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

  // 1b. Phase 3 -> 5: adversary must have recorded PASS
  if (current === '3' && targetPhase === '5') {
    const g3 = state.gates['3'];
    if (!g3 || g3.verdict !== 'PASS') {
      throw new Error('Adversary gate (phase 3) must be PASS before entering phase 5');
    }
  }
  if (current === '4' && targetPhase !== '4') {
    const routingCheck = validateFeedbackRoutingTarget(featureName, state.sprintCount, targetPhase);
    if (!routingCheck.ok) {
      throw new Error(`Feedback routing check failed: ${routingCheck.reason}`);
    }
  }

  // 2. Check gate prerequisites
  const prereq = GATE_PREREQUISITES[targetPhase];
  if (prereq) {
    const featurePath = getFeaturePath(featureName);
    const prereqResult = prereq(state, featurePath);
    if (!prereqResult.ok) {
      throw new Error(`Gate prerequisite not met for phase ${targetPhase}: ${prereqResult.reason}`);
    }
  }

  // 3. Check iteration limits (safety valve)
  const iterCount = (state.iterations[targetPhase] || 0) + 1;
  const limit = getIterationLimit(state, targetPhase);
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

  // Both 1c→2a (initial sprint) and 4→2a (feedback-loop re-entry) begin a new sprint.
  // Evidence logs are named sprint-N-red-phase.log so each 2a entry must have its own sprint number.
  if (targetPhase === '2a' && (current === '1c' || current === '4')) {
    state.sprintCount += 1;
    startedSprint = true;
  }

  // complete→1a or complete→3: record a sprint boundary so history.jsonl captures the
  // transition out of complete. sprintCount is NOT incremented here — that still happens
  // at 1c→2a so evidence log names remain consistent. The nextSprintHint field in
  // phaseHistory signals which sprint cycle this phase belongs to.
  const isNextSprintEntry = current === 'complete';

  // 4. Apply transition
  state.currentPhase = targetPhase;
  state.iterations[targetPhase] = iterCount;
  state.phaseHistory.push({
    from: current,
    to: targetPhase,
    timestamp: new Date().toISOString(),
    reason: reason || undefined,
    sprint: state.sprintCount || undefined,
    ...(isNextSprintEntry ? { nextSprintHint: state.sprintCount + 1 } : {}),
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

  if (isNextSprintEntry) {
    appendHistory({
      event: 'sprint_boundary',
      featureName,
      // sprintCount has not yet been incremented; the next sprint number is a hint
      nextSprintHint: state.sprintCount + 1,
      phase: targetPhase,
    });
  }

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

function routeFeedback(featureName, targetPhase, reason) {
  const state = readState(featureName);
  if (state.currentPhase !== '3' && state.currentPhase !== '4') {
    throw new Error(`Feedback routing requires phase 3 or 4, current phase is ${state.currentPhase}`);
  }
  const routingCheck = validateFeedbackRoutingTarget(featureName, state.sprintCount, targetPhase);
  if (!routingCheck.ok) {
    throw new Error(`Feedback routing check failed: ${routingCheck.reason}`);
  }

  const specificityCheck = validateFindingSpecificity(featureName);
  if (!specificityCheck.ok) {
    throw new Error(`Feedback routing blocked: ${specificityCheck.reason}`);
  }

  if (state.currentPhase === '3') {
    transitionPhase(
      featureName,
      '4',
      reason || `Feedback integration: routing adversary findings toward phase ${targetPhase}`
    );
  }

  const result = transitionPhase(
    featureName,
    targetPhase,
    reason || `Feedback routing target selected: phase ${targetPhase}`
  );

  // Coherence impact analysis (advisory — only when coherence.json exists)
  const featurePath = getFeaturePath(featureName);
  const coherencePath = path.join(featurePath, 'coherence.json');
  if (fs.existsSync(coherencePath)) {
    try {
      const {
        loadCoherence,
        propagateImpact,
        impactNodeIncomingStats,
        collectConventionAlerts,
      } = require('./vcsdd-coherence');
      const ceg = loadCoherence(featureName);
      if (ceg) {
        // Find start nodes: prefer nodes mentioned in the reason string,
        // fall back to spec nodes only when routing to a spec phase (1a/1b/1c).
        // Skip impact logging entirely when no relevant start nodes are found.
        const allNodeIds = Object.keys(ceg.nodes);
        const mentionedNodes = allNodeIds.filter(id => reason && reason.includes(id));
        const startNodes = mentionedNodes.length > 0
          ? mentionedNodes
          : (targetPhase.startsWith('1')
            ? allNodeIds.filter(id => {
                const n = ceg.nodes[id];
                return n.path && n.path.startsWith('specs/') &&
                  (n.type === 'design' || n.type === 'requirement');
              })
            : []);
        if (startNodes.length > 0) {
          const impacts = propagateImpact(ceg, startNodes, 5, 0.5);
          const conventionAlerts = collectConventionAlerts(ceg, startNodes);
          if (impacts.size > 0 || conventionAlerts.length > 0) {
            appendHistory({
              event: 'coherence_impact',
              featureName,
              routedToPhase: targetPhase,
              startNodes,
              impactedNodes: [...impacts.entries()].map(([id, info]) => {
                const { evidenceCount, maxConfidence } = impactNodeIncomingStats(ceg, id);
                return {
                  nodeId: id,
                  depth: info.depth,
                  confidence: maxConfidence,
                  evidenceCount,
                };
              }),
              conventionAlerts: conventionAlerts.map((alert) => ({
                sourceNode: alert.sourceNode,
                targetId: alert.targetId,
                targetName: alert.targetName,
                targetType: alert.targetType,
                reason: alert.reason,
                confidence: alert.confidence,
                triggeredByNodeId: alert.triggeredByNodeId,
              })),
            });
          }
        }
      }
    } catch (err) {
      // Coherence impact is advisory — log but do not block routing on errors
      appendHistory({
        event:       'coherence_check_error',
        featureName,
        phase:       'feedback',
        error:       err.message,
      });
    }
  }

  return result;
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
  assertValidDocument('index', index, 'VCSDD index');
  return index;
}

function writeIndex(index) {
  validateIndex(index);
  assertValidDocument('index', index, 'VCSDD index');
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
  atomicWriteText(filePath, content);

  appendHistory({
    event: 'escalation_created',
    featureName,
    phase: escalation.phase,
    iteration: escalation.iteration,
    limit: escalation.limit,
  });
}

function approveEscalation(featureName, phase, reason) {
  const state = readState(featureName);
  const limit = getIterationLimit(state, phase);
  if (!limit) {
    throw new Error(`Phase ${phase} has no iteration limit configured`);
  }

  const iterCount = state.iterations[phase] || 0;
  if (iterCount <= limit) {
    throw new Error(`Phase ${phase} has not exceeded its iteration limit (${iterCount}/${limit}). No escalation needed.`);
  }

  const approvalReason = reason || 'Architect approved continuation';

  // Reset iteration counter to (limit - 1) so next transitionPhase call lands at exactly limit
  state.iterations[phase] = limit - 1;

  // Record approval in phaseHistory
  state.phaseHistory.push({
    from: state.currentPhase,
    to: state.currentPhase,
    timestamp: new Date().toISOString(),
    reason: `Architect escalation approved for phase ${phase}: ${approvalReason}`,
    escalationApproved: true,
  });

  state.updatedAt = new Date().toISOString();
  writeState(featureName, state);

  // Mark escalation files for this phase as resolved
  const escalationDir = path.join(getFeaturePath(featureName), 'escalations');
  if (fs.existsSync(escalationDir)) {
    const files = fs.readdirSync(escalationDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const filePath = path.join(escalationDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      // Only amend files that mention this phase and are not already resolved
      if (content.includes(`**Phase**: ${phase}`) && !content.includes('## Resolution')) {
        const resolution = `\n## Resolution\n\nApproved by Architect at ${new Date().toISOString()}.\n` +
          `Reason: ${approvalReason}\n` +
          `Iteration counter reset to ${limit - 1} (limit: ${limit}).\n`;
        atomicWriteText(filePath, content + resolution);
      }
    }
  }

  appendHistory({
    event: 'escalation_approved',
    featureName,
    phase,
    previousIteration: iterCount,
    newIteration: limit - 1,
    reason: approvalReason,
  });

  return { phase, previousIteration: iterCount, newIteration: limit - 1, limit };
}

// ── Feature Initialization ──

function initFeature(featureName, mode = 'lean', language = null) {
  if (!featureName || typeof featureName !== 'string') {
    throw new Error('featureName is required');
  }
  if (!FEATURE_NAME_RE.test(featureName)) {
    throw new Error('featureName must be kebab-case using lowercase letters, numbers, and hyphens');
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
    'verification/security-results',
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
      epicId: `VCSDD-${featureName}-${timestamp}`,
      beads: [],
    },
    gates: {},
    sprintCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  validateState(state);
  assertValidDocument('state', state, `state for feature ${featureName}`);
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
  VCSDD_DIR,
  VALID_PHASES,
  VALID_LANGUAGES,
  STRICT_TRANSITION_MAP,
  TRANSITION_MAP,
  ITERATION_LIMITS,
  getIterationLimit,
  getAllowedTransitions,

  // Path helpers
  getVcsddRoot,
  getFeaturePath,
  getStatePath,
  getIndexPath,
  getActiveFeaturePath,
  getHistoryPath,
  getSprintContractPath,
  getSprintContractReviewPath,
  computeSprintContractReviewDigest,

  // State CRUD
  readState,
  writeState,
  deleteState,

  // Phase transitions
  validateTransition,
  transitionPhase,
  routeFeedback,

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
  approveEscalation,

  // Feature lifecycle
  initFeature,

  // Gate recording
  recordGate,

  // Sprint management
  startSprint,
  validateApprovedSprintContract,
  validateSprintContractReview,
  validateCriteriaCoverage,
  validateFeedbackRoutingTarget,
  validateFormalHardeningArtifacts,
  getAllFindingFiles,
  validateFindingBeadCoverage,
};
