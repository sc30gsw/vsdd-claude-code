'use strict';

/**
 * vcsdd-coherence.js
 *
 * Coherence Engine for VCSDD — implements the core mechanisms of
 * Coherence-Driven Development (CoDD) natively in Node.js:
 *
 *   - CEG (Conditioned Evidence Graph): dependency graph between spec docs
 *   - Noisy-OR confidence scoring with evidence accumulation
 *   - Green / Amber / Gray band classification
 *   - BFS forward impact propagation
 *   - Iterative DFS cycle detection (stack-safe)
 *   - Frontmatter scanning and CEG rebuild
 *   - Reference integrity validation
 *
 * Data is stored in `.vcsdd/features/<name>/coherence.json`, completely
 * independent of state.json so existing VCSDD guarantees are preserved.
 * When coherence.json is absent the engine is a no-op — all coherence
 * checks are silently skipped and no existing workflow is affected.
 */

const fs   = require('fs');
const path = require('path');
const childProcess = require('child_process');
const crypto = require('crypto');

// ── Constants ──────────────────────────────────────────────────────────────

const VCSDD_DIR       = '.vcsdd';
const COHERENCE_FILE  = 'coherence.json';
const COHERENCE_VERSION = 1;

/** Maximum allowed nodes / edges per CEG (DoS guard). */
const MAX_NODES = 10_000;
const MAX_EDGES = 50_000;

/** Evidence source types that are regenerated on every scan (purged first). */
const AUTO_SOURCE_TYPES  = new Set(['frontmatter', 'static', 'framework', 'inferred']);

/** Evidence source types authored by humans (never purged). */
const HUMAN_SOURCE_TYPES = new Set(['human', 'dynamic', 'history']); // eslint-disable-line no-unused-vars

/** Default band thresholds (same as CoDD defaults). */
const DEFAULT_BANDS = {
  green: { minConfidence: 0.90, minEvidenceCount: 2 },
  amber: { minConfidence: 0.50 },
};

/** Default edge scores per frontmatter key. */
const FRONTMATTER_SCORES = {
  depends_on:        0.9,
  depended_by:       0.9,
  modules:           0.85,
  conventions:       0.8,
  data_dependencies: 0.75,
  source_files:      0.85,
};

/** Infer node type from node_id prefix. */
const PREFIX_TYPE_MAP = {
  'req:':        'requirement',
  'design:':     'design',
  'db_table:':   'db_table',
  'db_column:':  'db_column',
  'module:':     'module',
  'file:':       'file',
  'test:':       'test_case',
  'config:':     'config_key',
  'endpoint:':   'endpoint',
  'infra:':      'infrastructure',
  'governance:': 'governance',
  'doc:':        'document',
  'db:':         'db_object',
  'detail:':     'detailed_design',
  'plan:':       'plan',
  'ops:':        'operations',
};

/** Keys that must never be set on plain objects (prototype-pollution guard). */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---/;

/**
 * Node prefixes that represent concrete artifacts and do not require a
 * matching Markdown document to exist in specs/.
 */
const CONCRETE_ARTIFACT_PREFIXES = [
  'module:',
  'file:',
  'db_table:',
  'db_column:',
  'config:',
  'endpoint:',
  'infra:',
  'ops:',
];

// ── Input validation ───────────────────────────────────────────────────────

/**
 * Validate a feature name to prevent path traversal.
 * Throws on invalid input.
 */
function validateFeatureName(featureName) {
  if (typeof featureName !== 'string' || featureName.length === 0) {
    throw new Error('Feature name must be a non-empty string');
  }
  if (/[/\\]/.test(featureName) || featureName.includes('..')) {
    throw new Error(`Invalid feature name "${featureName}": path separators / traversal sequences are not allowed`);
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(featureName)) {
    throw new Error(`Invalid feature name "${featureName}": must be lowercase alphanumeric with hyphens`);
  }
}

/**
 * Validate a relative file path from frontmatter (source_files, etc.).
 * Returns the normalised path, or null if invalid/dangerous.
 */
function sanitizeRelativePath(p) {
  if (typeof p !== 'string' || path.isAbsolute(p)) return null;
  const normalised = path.normalize(p);
  if (normalised.startsWith('..')) return null;
  return normalised;
}

function isConcreteArtifactNodeId(nodeId) {
  return typeof nodeId === 'string' &&
    CONCRETE_ARTIFACT_PREFIXES.some(prefix => nodeId.startsWith(prefix));
}

function ensureReferencedNode(ceg, nodeId) {
  if (typeof nodeId !== 'string' || nodeId.length === 0) return null;
  if (ceg.nodes[nodeId]) return ceg.nodes[nodeId];

  if (isConcreteArtifactNodeId(nodeId)) {
    const inferredType = Object.entries(PREFIX_TYPE_MAP)
      .find(([prefix]) => nodeId.startsWith(prefix))?.[1];
    const name = nodeId.includes(':') ? nodeId.split(':').slice(1).join(':') : nodeId;
    return upsertNode(ceg, nodeId, { type: inferredType, name, placeholder: false });
  }

  return upsertNode(ceg, nodeId);
}

function normalizeModuleId(moduleRef) {
  if (typeof moduleRef !== 'string') return '';
  const trimmed = moduleRef.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('module:') ? trimmed : `module:${trimmed}`;
}

function isValidNodeId(nodeId) {
  return typeof nodeId === 'string' &&
    /^[a-z_]+:.+$/.test(nodeId) &&
    Object.keys(PREFIX_TYPE_MAP).some(prefix => nodeId.startsWith(prefix));
}

// ── Path helpers ───────────────────────────────────────────────────────────

function getVcsddRoot() {
  return path.resolve(process.cwd(), VCSDD_DIR);
}

function getFeaturePath(featureName) {
  validateFeatureName(featureName);
  const base    = path.join(getVcsddRoot(), 'features');
  const resolved = path.join(base, featureName);
  // Defence-in-depth: verify result is still under features/
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path traversal detected for feature name "${featureName}"`);
  }
  return resolved;
}

function getCoherencePath(featureName) {
  return path.join(getFeaturePath(featureName), COHERENCE_FILE);
}

function resolveProjectRoot(featureName) {
  const featurePath = getFeaturePath(featureName);
  return path.resolve(featurePath, '..', '..', '..');
}

// ── Atomic write (same pattern as vcsdd-state.js) ─────────────────────────

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
}

// ── CEG structural validation ──────────────────────────────────────────────

/**
 * Basic structural check for a loaded CEG object.
 * Returns true only if the object is safe to use.
 */
function isValidCegStructure(ceg) {
  if (!ceg || typeof ceg !== 'object' || Array.isArray(ceg)) return false;
  if (typeof ceg.nodes !== 'object' || Array.isArray(ceg.nodes)) return false;
  if (!Array.isArray(ceg.edges)) return false;
  if (Object.keys(ceg.nodes).length > MAX_NODES) return false;
  if (ceg.edges.length > MAX_EDGES) return false;
  return true;
}

// ── CEG lifecycle ──────────────────────────────────────────────────────────

/**
 * Load coherence.json for a feature.
 * Returns null when the file does not exist or the structure is invalid.
 */
function loadCoherence(featureName) {
  const p = getCoherencePath(featureName);
  if (!fs.existsSync(p)) return null;
  try {
    const ceg = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!isValidCegStructure(ceg)) return null;
    return ceg;
  } catch {
    return null;
  }
}

/**
 * Load coherence.json with status information.
 * Returns { ceg, status } where status is 'loaded' | 'not_found' | 'corrupted'.
 * On corruption, creates a .bak backup automatically.
 */
function loadCoherenceWithStatus(featureName) {
  const p = getCoherencePath(featureName);
  if (!fs.existsSync(p)) return { ceg: null, status: 'not_found' };
  try {
    const ceg = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!isValidCegStructure(ceg)) {
      _backupCorruptedFile(p);
      return { ceg: null, status: 'corrupted' };
    }
    return { ceg, status: 'loaded' };
  } catch {
    _backupCorruptedFile(p);
    return { ceg: null, status: 'corrupted' };
  }
}

function _backupCorruptedFile(filePath) {
  try {
    fs.copyFileSync(filePath, filePath + '.bak');
  } catch {
    // Best-effort backup; proceed even if it fails
  }
}

/** Save coherence data atomically. */
function saveCoherence(featureName, ceg) {
  ceg.lastScanAt = new Date().toISOString();
  atomicWriteJson(getCoherencePath(featureName), ceg);
}

/** Initialise an empty CEG for a feature. */
function initCoherence(featureName) {
  const ceg = {
    version: COHERENCE_VERSION,
    nodes:   {},
    edges:   [],
    lastScanAt: new Date().toISOString(),
  };
  saveCoherence(featureName, ceg);
  return ceg;
}

// ── Node operations ────────────────────────────────────────────────────────

/**
 * Insert or update a node.
 * Existing fields are preserved; only provided fields are merged in.
 */
function upsertNode(ceg, nodeId, data = {}) {
  if (typeof nodeId !== 'string' || DANGEROUS_KEYS.has(nodeId)) return null;
  const existing = ceg.nodes[nodeId] || {};
  const inferredType = Object.entries(PREFIX_TYPE_MAP)
    .find(([prefix]) => nodeId.startsWith(prefix))?.[1] ?? 'document';

  ceg.nodes[nodeId] = {
    ...existing,
    id:   nodeId,
    type: data.type  ?? existing.type  ?? inferredType,
    // placeholder: true when auto-created by addEdge (no explicit data),
    // false when created from scanned frontmatter. Preserve existing value.
    placeholder: data.placeholder ?? existing.placeholder ?? true,
    ...(data.path   !== undefined ? { path:   data.path   } : {}),
    ...(data.name   !== undefined ? { name:   data.name   } : {}),
    ...(data.module !== undefined ? { module: data.module } : {}),
  };
  return ceg.nodes[nodeId];
}

// ── Edge operations ────────────────────────────────────────────────────────

/**
 * Add an edge (or accumulate evidence on an existing one).
 * Uses reduce instead of spread to avoid stack overflow on large arrays.
 */
function addEdge(ceg, sourceId, targetId, relation, semantic, evidenceItems) {
  if (!ceg.nodes[sourceId]) upsertNode(ceg, sourceId);
  if (!ceg.nodes[targetId]) upsertNode(ceg, targetId);

  const existing = ceg.edges.find(
    e => e.sourceId === sourceId && e.targetId === targetId && e.relation === relation && e.semantic === semantic,
  );

  if (existing) {
    existing.evidence.push(...evidenceItems);
    existing.confidence = calculateConfidence(existing.evidence);
    return existing;
  }

  // Use reduce instead of Math.max(...array) to avoid stack overflow
  const maxId = ceg.edges.reduce((m, e) => (e.id > m ? e.id : m), 0);
  const edge  = {
    id:         maxId + 1,
    sourceId,
    targetId,
    relation,
    semantic,
    confidence: calculateConfidence(evidenceItems),
    isActive:   true,
    evidence:   [...evidenceItems],
  };
  ceg.edges.push(edge);
  return edge;
}

/**
 * Remove all auto-generated evidence from each edge.
 * Edges with zero remaining evidence are deleted.
 * Orphan nodes (no remaining edges) are also removed.
 * Human evidence is never touched.
 */
function removeAutoEvidence(ceg) {
  const deletedEdges = [];

  for (let i = ceg.edges.length - 1; i >= 0; i--) {
    const edge = ceg.edges[i];
    edge.evidence = edge.evidence.filter(e => !AUTO_SOURCE_TYPES.has(e.sourceType));

    if (edge.evidence.length === 0) {
      deletedEdges.push(edge);
      ceg.edges.splice(i, 1);
    } else {
      edge.confidence = calculateConfidence(edge.evidence);
    }
  }

  const referencedIds = new Set(
    ceg.edges.flatMap(e => [e.sourceId, e.targetId]),
  );
  for (const nodeId of Object.keys(ceg.nodes)) {
    if (!referencedIds.has(nodeId)) {
      delete ceg.nodes[nodeId];
    }
  }

  return { deletedEdges };
}

// ── Confidence & band ──────────────────────────────────────────────────────

/**
 * Noisy-OR confidence calculation (identical to CoDD's _noisy_or).
 *
 * Formula: max(0, negProduct - posProduct), rounded to 4 dp.
 * Note: max(0, …) is applied BEFORE rounding, matching Python's
 *       `round(max(0.0, …), 4)` semantics.
 */
function calculateConfidence(evidence) {
  let posProduct = 1.0;
  let negProduct = 1.0;

  for (const e of evidence) {
    // Clamp score to [0, 1] to prevent unexpected results from hand-edited data
    const s = typeof e.score === 'number'
      ? Math.max(0, Math.min(1, e.score))
      : 0.5;

    if (e.isNegative) {
      negProduct *= (1.0 - s);
    } else {
      posProduct *= (1.0 - s);
    }
  }

  // Apply max(0) FIRST, then round — matching Python's order
  const raw = negProduct - posProduct;
  return Math.round(Math.max(0, raw) * 10000) / 10000;
}

/**
 * Classify an edge confidence + evidence count into a band.
 *
 * @returns {'green'|'amber'|'gray'}
 */
function classifyBand(confidence, evidenceCount, bands = DEFAULT_BANDS) {
  const g = bands.green ?? DEFAULT_BANDS.green;
  const a = bands.amber ?? DEFAULT_BANDS.amber;

  if (confidence >= g.minConfidence && evidenceCount >= g.minEvidenceCount) return 'green';
  if (confidence >= a.minConfidence) return 'amber';
  return 'gray';
}

// ── Impact propagation ─────────────────────────────────────────────────────

/**
 * BFS forward impact propagation.
 *
 * Traces in the *reverse dependency direction*: given a set of changed
 * nodes, finds all nodes that (transitively) depend ON them.
 *
 * BFS guarantees shortest-path (minimum depth) semantics.  A node is only
 * enqueued when the candidate depth is strictly less than any previously
 * recorded depth — this correctly handles multiple start nodes.
 *
 * @returns {Map<string, {depth, path, source}>}
 */
function propagateImpact(ceg, startNodeIds, maxDepth = 10, minConfidence = 0) {
  // visited: nodeId -> { depth, path, source }
  // Confidence is NOT tracked during BFS — it is looked up from edges at
  // report time, matching the CoDD reference implementation (propagate.py).
  const visited = new Map();

  // Seed the queue with all start nodes at depth 0
  // Queue entry: [nodeId, depth, nodePath, sourceNodeId]
  const queue = startNodeIds.map(id => [id, 0, [id], id]);

  while (queue.length > 0) {
    // Note: For very large graphs, a head-index queue and an adjacency index
    // (targetId -> incoming edges) would reduce overhead vs shift()+full scans.
    const [current, depth, nodePath, source] = queue.shift(); // FIFO = BFS

    if (depth > maxDepth) continue;

    const existing = visited.get(current);
    // Only process if we found a strictly shorter path
    if (existing && existing.depth <= depth) continue;

    visited.set(current, { depth, path: nodePath, source });

    // Incoming edges: nodes whose targetId === current (depend ON current)
    for (const edge of ceg.edges) {
      if (edge.targetId !== current) continue;
      if (!edge.isActive) continue;
      if (edge.confidence < minConfidence) continue;

      const dep         = edge.sourceId;
      const existingDep = visited.get(dep);
      // Enqueue if: never seen, OR the new depth would be strictly shorter
      if (!existingDep || existingDep.depth > depth + 1) {
        queue.push([dep, depth + 1, [...nodePath, dep], source]);
      }
    }
  }

  // Exclude start nodes themselves from results
  for (const startId of startNodeIds) visited.delete(startId);
  return visited;
}

/**
 * Active incoming edges to a node (same inputs as band classification in generateImpactReport).
 *
 * @returns {{ evidenceCount: number, maxConfidence: number }}
 */
function impactNodeIncomingStats(ceg, nodeId) {
  const nodeEdges     = ceg.edges.filter(e => e.targetId === nodeId && e.isActive);
  const evidenceCount = nodeEdges.length;
  // Use reduce instead of Math.max(...array) to avoid stack overflow on large arrays
  const maxConfidence = nodeEdges.reduce(
    (m, e) => (e.confidence > m ? e.confidence : m),
    0,
  );
  return { evidenceCount, maxConfidence };
}

function getConventionEdges(ceg, nodeId, minConfidence = 0) {
  const targetLookup = ceg.nodes ?? {};

  return ceg.edges
    .filter(edge =>
      edge.sourceId === nodeId &&
      edge.relation === 'must_review' &&
      edge.isActive &&
      edge.confidence >= minConfidence,
    )
    .sort((a, b) => b.confidence - a.confidence)
    .map(edge => ({
      ...edge,
      targetName: targetLookup[edge.targetId]?.name,
      targetType: targetLookup[edge.targetId]?.type,
    }));
}

function firstEvidenceDetail(edge) {
  for (const evidence of (edge.evidence ?? [])) {
    if (typeof evidence.detail === 'string' && evidence.detail.trim() !== '') {
      return evidence.detail;
    }
  }
  return '';
}

/**
 * Collect CoDD convention alerts for changed nodes.
 *
 * Mirrors upstream CoDD semantics:
 *   1. direct `must_review` edges from each changed node
 *   2. `must_review` edges from one-hop parents that depend on the changed node
 *
 * @returns {{
 *   sourceNode: string,
 *   targetId: string,
 *   targetName?: string,
 *   targetType?: string,
 *   reason: string,
 *   confidence: number,
 *   triggeredByNodeId: string,
 * }[]}
 */
function collectConventionAlerts(ceg, startNodeIds, minConfidence = 0) {
  const alerts = [];
  const checked = new Set();

  function pushAlert(sourceNode, edge, triggeredByNodeId) {
    const key = `${sourceNode}\u0000${edge.targetId}`;
    if (checked.has(key)) return;
    checked.add(key);

    alerts.push({
      sourceNode,
      targetId: edge.targetId,
      targetName: edge.targetName,
      targetType: edge.targetType,
      reason: firstEvidenceDetail(edge),
      confidence: edge.confidence,
      triggeredByNodeId,
    });
  }

  for (const nodeId of startNodeIds) {
    for (const edge of getConventionEdges(ceg, nodeId, minConfidence)) {
      pushAlert(nodeId, edge, nodeId);
    }

    const incomingEdges = ceg.edges.filter(edge =>
      edge.targetId === nodeId &&
      edge.isActive &&
      edge.confidence >= minConfidence,
    );
    for (const incomingEdge of incomingEdges) {
      const parentId = incomingEdge.sourceId;
      for (const edge of getConventionEdges(ceg, parentId, minConfidence)) {
        pushAlert(parentId, edge, nodeId);
      }
    }
  }

  return alerts;
}

/**
 * Generate a Markdown impact report.
 * Node labels are escaped to prevent Markdown injection.
 */
function generateImpactReport(impacts, ceg, bands = DEFAULT_BANDS, options = {}) {
  const conventionAlerts = Array.isArray(options.conventionAlerts)
    ? options.conventionAlerts
    : [];

  const green = [];
  const amber  = [];
  const gray   = [];

  for (const [nodeId, info] of impacts) {
    const node  = ceg.nodes[nodeId];
    const label = escapeMd(node?.name ?? node?.path ?? nodeId);

    // CoDD approach (propagate.py:240-245): classify band from the incoming
    // edges TO the impacted node — edges from nodes that depend ON this node.
    // This mirrors ceg.get_incoming_edges(target_id) in the upstream implementation.
    const { evidenceCount, maxConfidence: maxConf } = impactNodeIncomingStats(ceg, nodeId);

    const entry = {
      nodeId: escapeMd(nodeId),
      label,
      depth:      info.depth,
      confidence: maxConf,
      path:       info.path,
    };
    const band = classifyBand(maxConf, evidenceCount, bands);
    if (band === 'green') green.push(entry);
    else if (band === 'amber') amber.push(entry);
    else gray.push(entry);
  }

  const fmtEntry = e =>
    `- **${e.label}** (\`${e.nodeId}\`) — depth ${e.depth}, confidence ${(e.confidence * 100).toFixed(0)}%`;

  const lines = ['## Coherence Impact Report\n'];

  if (conventionAlerts.length > 0) {
    lines.push('### Convention Alerts\n');
    for (const alert of conventionAlerts) {
      const targetLabel = escapeMd(alert.targetName ?? alert.targetId);
      const sourceNode = escapeMd(alert.sourceNode);
      const targetNode = escapeMd(alert.targetId);
      const triggeredBy = escapeMd(alert.triggeredByNodeId ?? alert.sourceNode);
      const reason = alert.reason
        ? ` Reason: ${escapeMd(alert.reason)}.`
        : '';
      lines.push(
        `- **${targetLabel}** (\`${targetNode}\`) — review required because \`${sourceNode}\` was triggered via \`${triggeredBy}\`. Confidence ${(alert.confidence * 100).toFixed(0)}%.${reason}`,
      );
    }
    lines.push('');
  }

  if (impacts.size === 0) {
    if (conventionAlerts.length === 0) {
      lines.push('No impacted nodes found.\n');
    }
    return lines.join('\n');
  }

  if (green.length) {
    lines.push('### 🟢 Green — Auto-propagate safe\n');
    green.sort((a, b) => a.depth - b.depth).forEach(e => lines.push(fmtEntry(e)));
    lines.push('');
  }
  if (amber.length) {
    lines.push('### 🟡 Amber — Human review required\n');
    amber.sort((a, b) => a.depth - b.depth).forEach(e => lines.push(fmtEntry(e)));
    lines.push('');
  }
  if (gray.length) {
    lines.push('### ⚪ Gray — Informational only\n');
    gray.sort((a, b) => a.depth - b.depth).forEach(e => lines.push(fmtEntry(e)));
    lines.push('');
  }

  return lines.join('\n');
}

/** Escape Markdown special characters in user-controlled strings. */
function escapeMd(s) {
  return String(s).replace(/[*_`[\]<>\\#|~]/g, '\\$&');
}

// ── Cycle detection ─────────────────────────────────────────────────────────

/**
 * Build adjacency map from CEG edges (sourceId -> Set<targetId>).
 */
function buildAdjacency(ceg) {
  const adj = new Map();
  for (const edge of ceg.edges) {
    if (!edge.isActive) continue;
    if (!adj.has(edge.sourceId)) adj.set(edge.sourceId, new Set());
    adj.get(edge.sourceId).add(edge.targetId);
    if (!adj.has(edge.targetId)) adj.set(edge.targetId, new Set());
  }
  return adj;
}

/** Canonicalise a cycle: rotate to start with the lexicographically smallest node. */
function canonicalizeCycle(cycle) {
  let best = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[best]) best = i;
  }
  const rotated = [...cycle.slice(best), ...cycle.slice(0, best)];
  // Append start node at end to match CoDD's display format: A -> B -> C -> A
  return [...rotated, rotated[0]].join(' -> ');
}

/**
 * Iterative DFS cycle detection — stack-safe, no recursion.
 *
 * Equivalent to the recursive DFS-with-visiting-stack algorithm but
 * implemented iteratively to prevent call-stack overflow on large graphs.
 *
 * @returns {string[]} Sorted, deduplicated canonicalised cycle descriptions
 */
function detectCycles(ceg) {
  const adj     = buildAdjacency(ceg);
  const visited = new Set();
  const cycles  = new Set();

  for (const startNode of [...adj.keys()].sort()) {
    if (visited.has(startNode)) continue;

    // Iterative DFS:
    // Each frame: { node, neighbors (iterator), pathStack, visitingMap }
    // We simulate the recursive call with an explicit stack of frames.
    const visiting  = new Map(); // nodeId -> index in pathStack
    const pathStack = [];
    const frameStack = [{ node: startNode, neighbors: [...(adj.get(startNode) || [])], neighborIdx: 0 }];

    visiting.set(startNode, 0);
    pathStack.push(startNode);

    while (frameStack.length > 0) {
      const frame = frameStack[frameStack.length - 1];

      if (frame.neighborIdx < frame.neighbors.length) {
        const neighbor = frame.neighbors[frame.neighborIdx++];

        if (visiting.has(neighbor)) {
          // Back edge — extract cycle from pathStack
          const cycleStart = visiting.get(neighbor);
          const cycle = pathStack.slice(cycleStart);
          cycles.add(canonicalizeCycle(cycle));
        } else if (!visited.has(neighbor)) {
          // Recurse into neighbor
          visiting.set(neighbor, pathStack.length);
          pathStack.push(neighbor);
          frameStack.push({
            node:        neighbor,
            neighbors:   [...(adj.get(neighbor) || [])],
            neighborIdx: 0,
          });
        }
        // Already fully visited neighbors are skipped (cross/forward edges)
      } else {
        // All neighbors processed — pop this frame (backtrack)
        frameStack.pop();
        pathStack.pop();
        visiting.delete(frame.node);
        visited.add(frame.node);
      }
    }
  }

  return [...cycles].sort();
}

// ── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate the CEG for structural integrity.
 *
 * Checks:
 *   1. All edge source/target IDs reference known nodes
 *   2. No circular dependencies
 *
 * @returns {{ ok: boolean, reason?: string, warnings?: string[], errors?: string[], cycles?: string[] }}
 */
function validateCoherence(ceg) {
  const warnings = [];
  const errors   = [];

  // 1. Reference integrity
  for (const edge of ceg.edges) {
    if (!edge.isActive) continue;
    const src = ceg.nodes[edge.sourceId];
    const tgt = ceg.nodes[edge.targetId];
    if (!src) {
      errors.push(`Edge ${edge.id}: unknown source node "${edge.sourceId}"`);
    } else if (src.placeholder) {
      errors.push(`Edge ${edge.id}: source node "${edge.sourceId}" is a placeholder (no matching document found)`);
    }
    if (!tgt) {
      errors.push(`Edge ${edge.id}: unknown target node "${edge.targetId}"`);
    } else if (tgt.placeholder) {
      errors.push(`Edge ${edge.id}: target node "${edge.targetId}" is a placeholder (no matching document found)`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, reason: `Reference integrity errors: ${errors[0]}`, warnings, errors };
  }

  // 2. Cycle detection
  const cycles = detectCycles(ceg);
  if (cycles.length > 0) {
    return {
      ok:     false,
      reason: `Circular dependency detected: ${cycles[0]}`,
      warnings,
      errors,
      cycles,
    };
  }

  return { ok: true, warnings, errors: [], cycles: [] };
}

// ── Frontmatter scanning ───────────────────────────────────────────────────

/**
 * Extract YAML frontmatter block from Markdown content.
 * Returns the parsed `coherence:` or `codd:` sub-object, or null if absent.
 * Accepts both keys for upstream CoDD compatibility (`codd:` is the upstream
 * convention; `coherence:` is the VCSDD convention).
 */
function extractFrontmatter(content) {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) return null;
  try {
    const parsed = parseMinimalYaml(match[1]);
    if (!parsed) return null;
    if (typeof parsed.coherence === 'object') return parsed.coherence;
    if (typeof parsed.codd      === 'object') return parsed.codd;
    return null;
  } catch {
    return null;
  }
}

// ── Minimal YAML parser ────────────────────────────────────────────────────

/**
 * Parse the subset of YAML used in VCSDD coherence frontmatter.
 *
 * Supports:
 *   - Top-level and nested key: value pairs (2/4-space indent)
 *   - Arrays of scalars:        "  - value"
 *   - Arrays of mappings:       "  - key: value\n    key2: value2"
 *   - Scalar types: string, number, boolean, null
 *
 * Security:
 *   - DANGEROUS_KEYS (__proto__, constructor, prototype) are ignored
 *   - Uses Object.create(null) for root to prevent prototype pollution
 *
 * Limitation: does not support multi-line scalars (| or >) — these are
 * not used in coherence frontmatter.
 */
function parseMinimalYaml(yamlText) {
  const lines = yamlText.split('\n');
  const root  = Object.create(null); // Prototype-pollution-safe

  // Each scope: { obj, arrayKey, indent }
  //   obj      - the current mapping object (or parent when in array mode)
  //   arrayKey - if non-null, obj[arrayKey] is the current array we append to
  //   indent   - the indent level that opened this scope
  const scopes = [{ obj: root, arrayKey: null, indent: -1 }];

  function currentScope() { return scopes[scopes.length - 1]; }

  function safeSet(obj, key, value) {
    if (!DANGEROUS_KEYS.has(key)) {
      obj[key] = value;
    }
  }

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx];
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const indent = rawLine.search(/\S/);

    // Pop scopes whose indent >= current line's indent
    while (scopes.length > 1 && currentScope().indent >= indent) {
      scopes.pop();
    }

    const scope = currentScope();

    if (trimmed.startsWith('- ')) {
      // ── Array item ──────────────────────────────────────────────────────
      const rest   = trimmed.slice(2).trim();
      // If this array item is a quoted scalar, it may contain ':' (e.g. "module:auth").
      // In that case it must be treated as a scalar, not as an inline mapping.
      const kvMatch = (rest.startsWith('"') || rest.startsWith("'"))
        ? null
        : rest.match(/^([^:]+):\s*(.*)$/);

      if (scope.arrayKey !== null && Array.isArray(scope.obj[scope.arrayKey])) {
        if (kvMatch) {
          // Object item: start a new mapping and push it onto the array
          const item = Object.create(null);
          const key   = kvMatch[1].trim();
          const value = kvMatch[2].trim();

          if (value === '') {
            // Empty value within an array item — mirror the lookahead logic
            // used by the key:value branch below so nested arrays like:
            //
            //   - targets:
            //       - "module:auth"
            //
            // are parsed correctly.
            let nextIsArray = false;
            let nextIsChild = false;
            for (let j = lineIdx + 1; j < lines.length; j++) {
              const next = lines[j].trim();
              if (next === '' || next.startsWith('#')) continue;
              const nextIndent = lines[j].length - lines[j].trimStart().length;
              nextIsChild = nextIndent > indent;
              if (nextIsChild) {
                nextIsArray = next.startsWith('- ');
              }
              break;
            }

            if (nextIsChild && nextIsArray) {
              safeSet(item, key, []);
            } else if (nextIsChild) {
              safeSet(item, key, Object.create(null));
            } else {
              safeSet(item, key, []);
            }
          } else {
            safeSet(item, key, parseScalar(value));
          }

          scope.obj[scope.arrayKey].push(item);
          // Open a scope for further key: value lines in this same array item
          scopes.push({ obj: item, arrayKey: null, indent });

          if (value === '') {
            const currentValue = item[key];
            if (Array.isArray(currentValue)) {
              scopes.push({ obj: item, arrayKey: key, indent });
            } else if (currentValue && typeof currentValue === 'object') {
              scopes.push({ obj: currentValue, arrayKey: null, indent });
            }
          }
        } else {
          // Scalar item
          scope.obj[scope.arrayKey].push(parseScalar(rest));
        }
      } else {
        throw new Error(`Invalid YAML array item at line ${lineIdx + 1}`);
      }
    } else {
      // ── Key: value (or key:) ─────────────────────────────────────────────
      const kvMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
      if (!kvMatch) {
        throw new Error(`Invalid YAML line at line ${lineIdx + 1}: ${trimmed}`);
      }

      const key   = kvMatch[1].trim();
      const value = kvMatch[2].trim();

      if (DANGEROUS_KEYS.has(key)) continue;

      const targetObj = scope.obj;

      if (value === '') {
        // Value is empty — lookahead to determine if next content line is an
        // array item ("- ...") or a key:value mapping.  This distinction is
        // critical: `coherence:` is a nested map, while `depends_on:` is an
        // array.  Without lookahead the parser would always create an array,
        // causing `node_id`, `type`, etc. to be flattened to the root object.
        //
        // Crucially, the next line must also be indented DEEPER than the
        // current key — if it is a sibling or parent, this key has no
        // children and should default to an empty array (most array keys
        // like `depends_on:` with no items are written this way).
        let nextIsArray = false;
        let nextIsChild = false;
        for (let j = lineIdx + 1; j < lines.length; j++) {
          const next = lines[j].trim();
          if (next === '' || next.startsWith('#')) continue;
          const nextIndent = lines[j].length - lines[j].trimStart().length;
          nextIsChild = nextIndent > indent;
          if (nextIsChild) {
            nextIsArray = next.startsWith('- ');
          }
          break;
        }

        if (nextIsChild && nextIsArray) {
          // Array value: create [] and open array scope
          safeSet(targetObj, key, []);
          scopes.push({ obj: targetObj, arrayKey: key, indent });
        } else if (nextIsChild) {
          // Nested mapping: create {} and open object scope
          const nested = Object.create(null);
          safeSet(targetObj, key, nested);
          scopes.push({ obj: nested, arrayKey: null, indent });
        } else {
          // No children (sibling or dedent follows) — emit empty array.
          // In coherence frontmatter, list keys are often written with no items
          // and should default to an empty list. If a scalar key is left empty,
          // it will also default to [] under this minimal parser.
          safeSet(targetObj, key, []);
        }
      } else {
        safeSet(targetObj, key, parseScalar(value));
      }
    }
  }

  return root;
}

function parseScalar(s) {
  // Flow sequence: [] or [a, b, c]
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    const items = [];
    let current = '';
    let inQuote = null;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (inQuote) {
        current += ch;
        if (ch === inQuote) inQuote = null;
      } else if (ch === '"' || ch === "'") {
        current += ch;
        inQuote = ch;
      } else if (ch === ',') {
        items.push(parseScalar(current.trim()));
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim() !== '') items.push(parseScalar(current.trim()));
    return items;
  }
  if (s === 'true')  return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  const n = Number(s);
  if (!Number.isNaN(n) && s !== '') return n;
  // Strip surrounding quotes
  if ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// ── Spec frontmatter scanning ──────────────────────────────────────────────

/**
 * Scan all .md files under `featurePath/specs/` and extract `coherence:`
 * frontmatter blocks.
 *
 * @returns {{ filePath, relPath, coherence }[]}
 */
function scanSpecFrontmatter(featurePath) {
  return scanSpecFrontmatterDetailed(featurePath).entries;
}

/**
 * Resolve changed files from git diff. Defaults to HEAD, which means
 * "uncommitted changes" in normal git usage.
 *
 * @param {string} projectRoot
 * @param {string} diffTarget
 * @returns {{ ok: boolean, changedFiles: string[], error: string|null }}
 */
function getChangedFilesFromGit(projectRoot, diffTarget = 'HEAD') {
  const target = typeof diffTarget === 'string' && diffTarget.trim()
    ? diffTarget.trim()
    : 'HEAD';

  try {
    const stdout = childProcess.execFileSync(
      'git',
      ['diff', '--name-only', target],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return {
      ok: true,
      changedFiles: stdout.split('\n').map(line => line.trim()).filter(Boolean),
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      changedFiles: [],
      error: err.stderr?.toString?.().trim?.() || err.message || 'git diff failed',
    };
  }
}

/**
 * Resolve a set of changed files to graph start nodes.
 *
 * Resolution order mirrors CoDD intent:
 *   1. changed Markdown spec with `coherence:` or `codd:` frontmatter -> node_id
 *   2. exact `file:<path>` node
 *   3. any graph node whose stored `path` matches the changed file
 *
 * @param {object} ceg
 * @param {string} projectRoot
 * @param {string[]} changedFiles
 * @returns {{ nodeId: string, sourceFile: string, resolution: string }[]}
 */
function resolveChangedNodes(ceg, projectRoot, changedFiles) {
  const resolved = [];
  const seen = new Set();

  for (const changedFile of changedFiles) {
    if (typeof changedFile !== 'string' || !changedFile.trim()) continue;
    const relPath = sanitizeRelativePath(changedFile.trim());
    if (!relPath) continue;

    const fullPath = path.join(projectRoot, relPath);
    const isMarkdown = relPath.endsWith('.md');

    if (isMarkdown && fs.existsSync(fullPath)) {
      const frontmatter = extractFrontmatter(fs.readFileSync(fullPath, 'utf8'));
      if (frontmatter && typeof frontmatter.node_id === 'string' && ceg.nodes[frontmatter.node_id]) {
        if (!seen.has(frontmatter.node_id)) {
          resolved.push({
            nodeId: frontmatter.node_id,
            sourceFile: relPath,
            resolution: 'frontmatter.node_id',
          });
          seen.add(frontmatter.node_id);
        }
        continue;
      }
    }

    const fileNodeId = `file:${relPath}`;
    if (ceg.nodes[fileNodeId] && !seen.has(fileNodeId)) {
      resolved.push({
        nodeId: fileNodeId,
        sourceFile: relPath,
        resolution: 'file-node',
      });
      seen.add(fileNodeId);
    }

    for (const nodeId of Object.keys(ceg.nodes)) {
      const nodePath = sanitizeRelativePath(ceg.nodes[nodeId]?.path);
      if (!nodePath || nodePath !== relPath || seen.has(nodeId)) continue;
      resolved.push({
        nodeId,
        sourceFile: relPath,
        resolution: 'node.path',
      });
      seen.add(nodeId);
    }
  }

  return resolved;
}

/**
 * Auto-detect impact-analysis start nodes from git diff.
 *
 * @param {string} featureName
 * @param {{ diffTarget?: string }} options
 * @returns {{
 *   ok: boolean,
 *   changedFiles: string[],
 *   startNodes: { nodeId: string, sourceFile: string, resolution: string }[],
 *   error: string|null,
 *   diffTarget: string
 * }}
 */
function detectChangedNodes(featureName, options = {}) {
  const projectRoot = resolveProjectRoot(featureName);
  const diffTarget = typeof options.diffTarget === 'string' && options.diffTarget.trim()
    ? options.diffTarget.trim()
    : 'HEAD';
  const changed = getChangedFilesFromGit(projectRoot, diffTarget);
  if (!changed.ok) {
    return {
      ok: false,
      changedFiles: [],
      startNodes: [],
      error: changed.error,
      diffTarget,
    };
  }

  const ceg = loadCoherence(featureName);
  if (!ceg) {
    return {
      ok: false,
      changedFiles: changed.changedFiles,
      startNodes: [],
      error: 'coherence graph not found',
      diffTarget,
    };
  }

  return {
    ok: true,
    changedFiles: changed.changedFiles,
    startNodes: resolveChangedNodes(ceg, projectRoot, changed.changedFiles),
    error: null,
    diffTarget,
  };
}

/**
 * Scan all .md files under `featurePath/specs/`, collecting valid coherence
 * frontmatter entries and reporting malformed CoDD metadata as errors.
 *
 * @returns {{ entries: { filePath, relPath, coherence }[], errors: string[] }}
 */
function scanSpecFrontmatterDetailed(featurePath) {
  const specsDir = path.join(featurePath, 'specs');
  const entries  = [];
  const errors   = [];

  if (!fs.existsSync(specsDir)) return { entries, errors };

  function inspectFrontmatter(content, relPath) {
    const match = content.match(FRONTMATTER_PATTERN);
    if (!match) return { coherence: null, error: null };

    const frontmatterText = match[1];
    const mentionsCoherence = /^\s*(coherence|codd)\s*:/m.test(frontmatterText);
    if (!mentionsCoherence) return { coherence: null, error: null };

    let parsed;
    try {
      parsed = parseMinimalYaml(frontmatterText);
    } catch (err) {
      return {
        coherence: null,
        error: `invalid frontmatter in "${relPath}": ${err.message}`,
      };
    }

    const coherence = typeof parsed?.coherence === 'object' ? parsed.coherence
      : (typeof parsed?.codd === 'object' ? parsed.codd : null);

    if (!coherence || Array.isArray(coherence)) {
      return {
        coherence: null,
        error: `invalid frontmatter in "${relPath}": coherence block must be a mapping`,
      };
    }

    if (typeof coherence.node_id !== 'string' || coherence.node_id.trim() === '') {
      return {
        coherence: null,
        error: `invalid frontmatter in "${relPath}": coherence.node_id is required`,
      };
    }

    if (!isValidNodeId(coherence.node_id)) {
      return {
        coherence: null,
        error: `invalid node_id "${coherence.node_id}" in "${relPath}" (must match <prefix>:<name> with a known prefix)`,
      };
    }

    return { coherence, error: null };
  }

  // Recursive walk to match CoDD's os.walk() behaviour
  function walkDir(dir, relPrefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walkDir(path.join(dir, entry.name), path.join(relPrefix, entry.name));
      } else if (entry.name.endsWith('.md')) {
        const filePath  = path.join(dir, entry.name);
        const content   = fs.readFileSync(filePath, 'utf8');
        const relPath = path.join(relPrefix, entry.name);
        const result = inspectFrontmatter(content, relPath);
        if (result.error) {
          errors.push(result.error);
        } else if (result.coherence) {
          entries.push({ filePath, relPath, coherence: result.coherence });
        }
      }
    }
  }

  walkDir(specsDir, 'specs');
  return { entries, errors };
}

/**
 * Rebuild the CEG from spec frontmatter.
 *
 * Algorithm:
 *   1. If coherence.json exists, load it and purge auto-generated evidence
 *   2. If coherence.json is corrupted, keep the .bak backup and create a fresh CEG
 *   3. Otherwise create a fresh CEG
 *   4. Scan specs/ for `coherence:` frontmatter
 *   5. Add nodes + edges from each file
 *   6. Save and return the updated CEG
 */
function rebuildFromFrontmatter(featureName) {
  const featurePath = getFeaturePath(featureName);
  const { ceg: existingCeg } = loadCoherenceWithStatus(featureName);

  let ceg;
  if (existingCeg) {
    ceg = existingCeg;
    removeAutoEvidence(ceg);
  } else {
    ceg = {
      version:    COHERENCE_VERSION,
      nodes:      {},
      edges:      [],
      lastScanAt: new Date().toISOString(),
    };
  }

  const { entries, errors } = scanSpecFrontmatterDetailed(featurePath);
  if (errors.length > 0) {
    throw new Error(`[vcsdd-coherence] ${errors.join('; ')}`);
  }

  for (const { relPath, coherence } of entries) {
    const nodeId = coherence.node_id;
    upsertNode(ceg, nodeId, {
      type:        coherence.type,
      path:        relPath,
      name:        coherence.name,
      placeholder: false,
    });

    // depends_on: source→target edges
    for (const dep of (coherence.depends_on ?? [])) {
      const targetId = (typeof dep === 'object' ? dep.id : dep) ?? '';
      if (!targetId) continue;
      const relation = dep.relation ?? 'depends_on';
      ensureReferencedNode(ceg, targetId);
      addEdge(ceg, nodeId, targetId, relation, 'governance', [{
        sourceType: 'frontmatter', method: 'frontmatter',
        score: FRONTMATTER_SCORES.depends_on,
        detail: `Declared in ${relPath} depends_on`, isNegative: false,
      }]);
    }

    // depended_by: creates edges FROM the declared source TO this node
    for (const dep of (coherence.depended_by ?? [])) {
      const sourceId = (typeof dep === 'object' ? dep.id : dep) ?? '';
      if (!sourceId) continue;
      const relation = dep.relation ?? 'depends_on';
      ensureReferencedNode(ceg, sourceId);
      addEdge(ceg, sourceId, nodeId, relation, 'governance', [{
        sourceType: 'frontmatter', method: 'frontmatter',
        score: FRONTMATTER_SCORES.depended_by,
        detail: `Declared in ${relPath} depended_by`, isNegative: false,
      }]);
    }

    // modules: implementation modules linked to this spec (CoDD upstream field)
    for (const mod of (coherence.modules ?? [])) {
      const rawModuleId = typeof mod === 'object'
        ? (mod.id ?? mod.module ?? mod.name)
        : mod;
      const moduleId = normalizeModuleId(rawModuleId);
      if (!moduleId) continue;
      const relation = typeof mod === 'object' ? (mod.relation ?? 'implements') : 'implements';
      upsertNode(ceg, moduleId, {
        type: 'module',
        name: moduleId.slice('module:'.length),
        placeholder: false,
      });
      addEdge(ceg, moduleId, nodeId, relation, 'technical', [{
        sourceType: 'frontmatter', method: 'modules',
        score: FRONTMATTER_SCORES.modules,
        detail: `Module declared in ${relPath}`,
        isNegative: false,
      }]);
    }

    // conventions: must_review edges (CoDD semantic)
    for (const conv of (coherence.conventions ?? [])) {
      const targets = Array.isArray(conv.targets) ? conv.targets
        : (typeof conv.targets === 'string' ? [conv.targets] : []);
      for (const targetId of targets) {
        if (!targetId) continue;
        ensureReferencedNode(ceg, targetId);
        addEdge(ceg, nodeId, targetId, 'must_review', 'governance', [{
          sourceType: 'frontmatter', method: 'convention',
          score: FRONTMATTER_SCORES.conventions,
          detail: conv.reason ?? `Convention declared in ${relPath}`,
          isNegative: false,
        }]);
      }
    }

    // data_dependencies: intermediate db_column node + behavioral_dependency edges
    // Creates db_column:{table}.{column} as intermediate node.
    // Edge direction matches VCSDD semantics: edge(A, B) = "A depends_on B".
    //   - Declaring doc depends_on db_column
    //   - Each affected item depends_on db_column (when column changes, BFS via incoming
    //     edges surfaces all affected docs)
    for (const dep of (coherence.data_dependencies ?? [])) {
      const table  = dep.table  ?? '?';
      const column = dep.column ?? '?';
      const depId  = `db_column:${table}.${column}`;
      upsertNode(ceg, depId, { type: 'db_column', name: `${table}.${column}`, placeholder: false });
      // edge(nodeId, depId): declaring doc depends_on db_column
      addEdge(ceg, nodeId, depId, 'behavioral_dependency', 'behavioral', [{
        sourceType: 'frontmatter', method: 'data_dependency',
        score: FRONTMATTER_SCORES.data_dependencies,
        detail: dep.condition ?? `Data dependency declared in ${relPath}`,
        isNegative: false,
      }]);
      const affects = Array.isArray(dep.affects) ? dep.affects : [];
      for (const targetId of affects) {
        if (!targetId) continue;
        ensureReferencedNode(ceg, targetId);
        // edge(targetId, depId): affected item depends_on db_column
        // BFS from depId (following incoming edges) surfaces targetId when column changes
        addEdge(ceg, targetId, depId, 'behavioral_dependency', 'behavioral', [{
          sourceType: 'frontmatter', method: 'data_dependency',
          score: FRONTMATTER_SCORES.data_dependencies,
          detail: dep.condition ?? `Data dependency on ${table}.${column}`,
          isNegative: false,
        }]);
      }
    }

    // source_files: extracted_from edges (paths validated to prevent traversal)
    for (const srcFile of (coherence.source_files ?? [])) {
      const safePath = sanitizeRelativePath(srcFile);
      if (!safePath) continue; // Skip absolute paths / traversal attempts
      const fileNodeId = `file:${safePath}`;
      upsertNode(ceg, fileNodeId, { type: 'file', path: safePath, placeholder: false });
      addEdge(ceg, nodeId, fileNodeId, 'extracted_from', 'technical', [{
        sourceType: 'frontmatter', method: 'source_files',
        score: FRONTMATTER_SCORES.source_files,
        detail: `Source file declared in ${relPath}`,
        isNegative: false,
      }]);
    }
  }

  saveCoherence(featureName, ceg);
  return ceg;
}

/**
 * Refresh coherence data from current frontmatter, then validate it.
 *
 * This avoids validating a stale coherence.json after specs changed.
 *
 * @returns {{
 *   active: boolean,
 *   rebuilt: boolean,
 *   recoveredFromCorruption: boolean,
 *   scanResult: { entries: { filePath: string, relPath: string, coherence: object }[], errors: string[] },
 *   ceg: object | null,
 *   summary: object | null,
 *   validation: { ok: boolean, reason?: string, warnings?: string[], errors?: string[], cycles?: string[] },
 * }}
 */
function refreshAndValidateCoherence(featureName) {
  const featurePath = getFeaturePath(featureName);
  const coherencePath = getCoherencePath(featureName);
  const { status } = loadCoherenceWithStatus(featureName);
  const scanResult = scanSpecFrontmatterDetailed(featurePath);
  const active = scanResult.entries.length > 0 || scanResult.errors.length > 0 || fs.existsSync(coherencePath);

  if (!active) {
    return {
      active: false,
      rebuilt: false,
      recoveredFromCorruption: false,
      scanResult,
      ceg: null,
      summary: null,
      validation: { ok: true, warnings: [], errors: [], cycles: [] },
    };
  }

  if (scanResult.errors.length > 0) {
    return {
      active: true,
      rebuilt: false,
      recoveredFromCorruption: false,
      scanResult,
      ceg: null,
      summary: null,
      validation: {
        ok: false,
        reason: scanResult.errors[0],
        warnings: [],
        errors: [...scanResult.errors],
        cycles: [],
      },
    };
  }

  const ceg = rebuildFromFrontmatter(featureName);
  return {
    active: true,
    rebuilt: true,
    recoveredFromCorruption: status === 'corrupted',
    scanResult,
    ceg,
    summary: summarize(ceg),
    validation: validateCoherence(ceg),
  };
}

// ── Summary helpers ────────────────────────────────────────────────────────

/**
 * Compute a quick summary of the CEG for status display.
 */
function summarize(ceg, bands = DEFAULT_BANDS) {
  let green = 0;
  let amber  = 0;
  let gray   = 0;

  for (const edge of ceg.edges) {
    if (!edge.isActive) continue;
    const band = classifyBand(edge.confidence, edge.evidence.length, bands);
    if (band === 'green') green++;
    else if (band === 'amber') amber++;
    else gray++;
  }

  const cycles = detectCycles(ceg);

  return {
    nodeCount: Object.keys(ceg.nodes).length,
    edgeCount: ceg.edges.filter(e => e.isActive).length,
    green,
    amber,
    gray,
    hasCycles: cycles.length > 0,
    cycles,
  };
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  // Lifecycle
  loadCoherence,
  loadCoherenceWithStatus,
  saveCoherence,
  initCoherence,

  // Nodes & edges
  upsertNode,
  addEdge,
  removeAutoEvidence,

  // Confidence & band
  calculateConfidence,
  classifyBand,

  // Impact propagation
  propagateImpact,
  impactNodeIncomingStats,
  getConventionEdges,
  collectConventionAlerts,
  generateImpactReport,

  // Cycle detection & validation
  detectCycles,
  validateCoherence,

  // Frontmatter
  extractFrontmatter,
  scanSpecFrontmatter,
  scanSpecFrontmatterDetailed,
  rebuildFromFrontmatter,
  refreshAndValidateCoherence,
  getChangedFilesFromGit,
  resolveChangedNodes,
  detectChangedNodes,

  // Utilities
  summarize,
  escapeMd,
  sanitizeRelativePath,

  // Constants (for tests & callers)
  DEFAULT_BANDS,
  AUTO_SOURCE_TYPES,
  HUMAN_SOURCE_TYPES,
  MAX_NODES,
  MAX_EDGES,
};
