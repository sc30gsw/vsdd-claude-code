'use strict';

const { readState, writeState, appendHistory } = require('./vcsdd-state');

// ── Bead ID Generation ──

function nextBeadId(state) {
  const existing = (state.traceability.beads || []).map(b => {
    const num = parseInt(b.beadId.replace('BEAD-', ''), 10);
    return isNaN(num) ? 0 : num;
  });
  const max = existing.length > 0 ? Math.max(...existing) : 0;
  return `BEAD-${String(max + 1).padStart(3, '0')}`;
}

// ── Valid Bead Status Transitions ──

const BEAD_STATUS_TRANSITIONS = {
  'spec-requirement':      ['draft', 'active', 'superseded'],
  'verification-property': ['draft', 'active', 'proved', 'failed', 'superseded'],
  'test-case':             ['draft', 'red', 'green', 'passing', 'failing', 'superseded'],
  'implementation':        ['draft', 'implemented', 'failing', 'superseded'],
  'adversary-finding':     ['open', 'resolved'],
  'contract-criterion':    ['draft', 'active', 'resolved'],
};

function validateBeadStatus(type, status) {
  const allowed = BEAD_STATUS_TRANSITIONS[type];
  if (!allowed) {
    throw new Error(`Unknown bead type: ${type}`);
  }
  if (!allowed.includes(status)) {
    throw new Error(`Invalid status "${status}" for bead type "${type}". Allowed: ${allowed.join(', ')}`);
  }
}

// ── Bead CRUD ──

/**
 * Create a new bead and add it to the feature's traceability chain.
 * @param {string} featureName
 * @param {object} beadData - { type, artifactPath, status, linkedBeads?, externalId?, createdInPhase? }
 * @returns {object} The created bead with assigned beadId
 */
function createBead(featureName, beadData) {
  const state = readState(featureName);

  const { type, artifactPath, status, linkedBeads = [], externalId, createdInPhase } = beadData;

  if (!type || !artifactPath || !status) {
    throw new Error('Bead requires type, artifactPath, and status');
  }

  validateBeadStatus(type, status);

  const beadId = nextBeadId(state);
  const bead = {
    beadId,
    type,
    artifactPath,
    status,
    linkedBeads: [...linkedBeads],
    createdAt: new Date().toISOString(),
    createdInPhase: createdInPhase || state.currentPhase,
    ...(externalId && { externalId }),
  };

  state.traceability.beads.push(bead);

  // Bidirectional link: update all linked beads to also link to this new bead
  for (const linkedId of linkedBeads) {
    const linkedBead = state.traceability.beads.find(b => b.beadId === linkedId);
    if (linkedBead && !linkedBead.linkedBeads.includes(beadId)) {
      linkedBead.linkedBeads.push(beadId);
    }
  }

  writeState(featureName, state);
  appendHistory({
    event: 'bead_created',
    featureName,
    beadId,
    type,
    phase: state.currentPhase,
    ...(externalId && { externalId }),
  });

  return bead;
}

/**
 * Update the status of an existing bead.
 * @param {string} featureName
 * @param {string} beadId
 * @param {string} newStatus
 * @returns {object} The updated bead
 */
function updateBeadStatus(featureName, beadId, newStatus) {
  const state = readState(featureName);
  const bead = state.traceability.beads.find(b => b.beadId === beadId);

  if (!bead) {
    throw new Error(`Bead not found: ${beadId}`);
  }

  validateBeadStatus(bead.type, newStatus);

  const oldStatus = bead.status;
  bead.status = newStatus;

  writeState(featureName, state);
  appendHistory({
    event: 'bead_status_changed',
    featureName,
    beadId,
    from: oldStatus,
    to: newStatus,
    phase: state.currentPhase,
  });

  return bead;
}

// ── Linking ──

/**
 * Create a bidirectional link between two beads.
 * @param {string} featureName
 * @param {string} fromId
 * @param {string} toId
 */
function linkBeads(featureName, fromId, toId) {
  if (fromId === toId) throw new Error(`Cannot self-link bead: ${fromId}`);

  const state = readState(featureName);
  const beads = state.traceability.beads;

  const fromBead = beads.find(b => b.beadId === fromId);
  const toBead = beads.find(b => b.beadId === toId);

  if (!fromBead) throw new Error(`Bead not found: ${fromId}`);
  if (!toBead) throw new Error(`Bead not found: ${toId}`);

  if (!fromBead.linkedBeads.includes(toId)) {
    fromBead.linkedBeads.push(toId);
  }
  if (!toBead.linkedBeads.includes(fromId)) {
    toBead.linkedBeads.push(fromId);
  }

  writeState(featureName, state);
  appendHistory({
    event: 'bead_linked',
    featureName,
    from: fromId,
    to: toId,
    phase: state.currentPhase,
  });
}

/**
 * Remove a bidirectional link between two beads.
 * @param {string} featureName
 * @param {string} fromId
 * @param {string} toId
 */
function unlinkBeads(featureName, fromId, toId) {
  const state = readState(featureName);
  const beads = state.traceability.beads;

  const fromBead = beads.find(b => b.beadId === fromId);
  const toBead = beads.find(b => b.beadId === toId);

  if (fromBead) {
    fromBead.linkedBeads = fromBead.linkedBeads.filter(id => id !== toId);
  }
  if (toBead) {
    toBead.linkedBeads = toBead.linkedBeads.filter(id => id !== fromId);
  }

  writeState(featureName, state);
}

// ── Queries ──

/**
 * Get the full traceability chain from a given bead (BFS traversal).
 * @param {string} featureName
 * @param {string} beadId
 * @returns {{ root: object, chain: object[], depth: number }}
 */
function getChain(featureName, beadId) {
  const state = readState(featureName);
  const beadMap = new Map(state.traceability.beads.map(b => [b.beadId, b]));

  const root = beadMap.get(beadId);
  if (!root) throw new Error(`Bead not found: ${beadId}`);

  const visited = new Set();
  const chain = [];
  const queue = [beadId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    const bead = beadMap.get(current);
    if (bead) {
      chain.push(bead);
      for (const linked of bead.linkedBeads) {
        if (!visited.has(linked)) queue.push(linked);
      }
    }
  }

  return { root, chain, depth: visited.size };
}

/**
 * Find all beads of a given type.
 * @param {string} featureName
 * @param {string} type
 * @returns {object[]}
 */
function findBeadsByType(featureName, type) {
  const state = readState(featureName);
  return state.traceability.beads.filter(b => b.type === type);
}

/**
 * Find beads by external ID (e.g., REQ-001, PROP-001).
 * @param {string} featureName
 * @param {string} externalId
 * @returns {object|null}
 */
function findBeadByExternalId(featureName, externalId) {
  const state = readState(featureName);
  return state.traceability.beads.find(b => b.externalId === externalId) || null;
}

/**
 * Get beads with no linked beads (orphans) - a convergence warning signal.
 * @param {string} featureName
 * @returns {object[]}
 */
function getOrphanBeads(featureName) {
  const state = readState(featureName);
  return state.traceability.beads.filter(b => b.linkedBeads.length === 0);
}

/**
 * Validate chain completeness: check for orphan beads and incomplete spec->test->impl chains.
 * @param {string} featureName
 * @returns {{ valid: boolean, warnings: string[] }}
 */
function validateChainCompleteness(featureName) {
  const state = readState(featureName);
  const warnings = [];

  const orphans = getOrphanBeads(featureName);
  if (orphans.length > 0) {
    warnings.push(`${orphans.length} orphan bead(s) detected: ${orphans.map(b => b.beadId).join(', ')}`);
  }

  // Check each spec requirement has at least one test case
  const specReqs = state.traceability.beads.filter(b => b.type === 'spec-requirement');
  const testCaseIds = new Set(
    state.traceability.beads.filter(b => b.type === 'test-case').map(b => b.beadId)
  );

  for (const req of specReqs) {
    const linkedTests = req.linkedBeads.filter(id => testCaseIds.has(id));
    if (linkedTests.length === 0) {
      warnings.push(`Spec requirement ${req.beadId} (${req.externalId || req.artifactPath}) has no linked test cases`);
    }
  }

  return { valid: warnings.length === 0, warnings };
}

/**
 * Format a traceability chain for display.
 * @param {{ root: object, chain: object[] }} chainResult
 * @returns {string}
 */
function formatChain(chainResult) {
  const { root, chain } = chainResult;
  const statusEmoji = {
    active: '✅', draft: '📝', red: '🔴', green: '🟢',
    passing: '✅', failing: '❌', implemented: '✅',
    proved: '✅', failed: '❌', open: '⚠️',
    resolved: '✅', superseded: '⚡',
  };

  const lines = [
    `## Traceability Chain for ${root.beadId}`,
    `**Root**: ${root.beadId} [${root.type}] - ${root.artifactPath}`,
    '',
    '### Connected Beads:',
  ];

  for (const bead of chain) {
    const emoji = statusEmoji[bead.status] || '❓';
    const ext = bead.externalId ? ` (${bead.externalId})` : '';
    lines.push(
      `- ${emoji} **${bead.beadId}** [${bead.type}]${ext}`,
      `  Path: ${bead.artifactPath}`,
      `  Status: ${bead.status}`,
      `  Links: ${bead.linkedBeads.join(', ') || 'none'}`,
    );
  }

  return lines.join('\n');
}

module.exports = {
  createBead,
  updateBeadStatus,
  linkBeads,
  unlinkBeads,
  getChain,
  findBeadsByType,
  findBeadByExternalId,
  getOrphanBeads,
  validateChainCompleteness,
  formatChain,
};
