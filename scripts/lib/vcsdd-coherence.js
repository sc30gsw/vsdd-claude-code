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

/**
 * Generate a Markdown impact report.
 * Node labels are escaped to prevent Markdown injection.
 */
function generateImpactReport(impacts, ceg, bands = DEFAULT_BANDS) {
  if (impacts.size === 0) {
    return '## Coherence Impact Report\n\nNo impacted nodes found.\n';
  }

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
 * @returns {{ ok: boolean, reason?: string, warnings?: string[], cycles?: string[] }}
 */
function validateCoherence(ceg) {
  const warnings = [];

  // 1. Reference integrity
  for (const edge of ceg.edges) {
    if (!edge.isActive) continue;
    const src = ceg.nodes[edge.sourceId];
    const tgt = ceg.nodes[edge.targetId];
    if (!src) {
      warnings.push(`Edge ${edge.id}: unknown source node "${edge.sourceId}"`);
    } else if (src.placeholder) {
      warnings.push(`Edge ${edge.id}: source node "${edge.sourceId}" is a placeholder (no matching document found)`);
    }
    if (!tgt) {
      warnings.push(`Edge ${edge.id}: unknown target node "${edge.targetId}"`);
    } else if (tgt.placeholder) {
      warnings.push(`Edge ${edge.id}: target node "${edge.targetId}" is a placeholder (no matching document found)`);
    }
  }

  // 2. Cycle detection
  const cycles = detectCycles(ceg);
  if (cycles.length > 0) {
    return {
      ok:     false,
      reason: `Circular dependency detected: ${cycles[0]}`,
      warnings,
      cycles,
    };
  }

  return { ok: true, warnings, cycles: [] };
}

// ── Frontmatter scanning ───────────────────────────────────────────────────

/**
 * Extract YAML frontmatter block from Markdown content.
 * Returns the parsed `coherence:` sub-object, or null if absent.
 */
function extractFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    const parsed = parseMinimalYaml(match[1]);
    return (parsed && typeof parsed.coherence === 'object') ? parsed.coherence : null;
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
      }
      // If no arrayKey in current scope, the array item is ignored
    } else {
      // ── Key: value (or key:) ─────────────────────────────────────────────
      const kvMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
      if (!kvMatch) continue;

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
  const specsDir = path.join(featurePath, 'specs');
  const results  = [];

  if (!fs.existsSync(specsDir)) return results;

  // Recursive walk to match CoDD's os.walk() behaviour
  function walkDir(dir, relPrefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walkDir(path.join(dir, entry.name), path.join(relPrefix, entry.name));
      } else if (entry.name.endsWith('.md')) {
        const filePath  = path.join(dir, entry.name);
        const content   = fs.readFileSync(filePath, 'utf8');
        const coherence = extractFrontmatter(content);
        if (coherence) {
          results.push({ filePath, relPath: path.join(relPrefix, entry.name), coherence });
        }
      }
    }
  }

  walkDir(specsDir, 'specs');
  return results;
}

/**
 * Rebuild the CEG from spec frontmatter.
 *
 * Algorithm:
 *   1. If coherence.json exists, load it and purge auto-generated evidence
 *   2. Otherwise create a fresh CEG
 *   3. Scan specs/ for `coherence:` frontmatter
 *   4. Add nodes + edges from each file
 *   5. Save and return the updated CEG
 */
function rebuildFromFrontmatter(featureName) {
  const featurePath = getFeaturePath(featureName);
  const { ceg: existingCeg, status } = loadCoherenceWithStatus(featureName);

  let ceg;
  if (existingCeg) {
    ceg = existingCeg;
    removeAutoEvidence(ceg);
  } else {
    if (status === 'corrupted') {
      console.warn(
        `[vcsdd-coherence] WARNING: coherence.json for "${featureName}" was corrupted. ` +
        `A backup has been saved to coherence.json.bak. Human evidence may have been lost.`,
      );
    }
    ceg = {
      version:    COHERENCE_VERSION,
      nodes:      {},
      edges:      [],
      lastScanAt: new Date().toISOString(),
    };
  }

  const entries = scanSpecFrontmatter(featurePath);

  for (const { relPath, coherence } of entries) {
    const rawNodeId = coherence.node_id ?? `doc:${relPath}`;
    // Validate node_id format: must be "<known-prefix><name>" matching /^[a-z_]+:.+$/
    // and the prefix must be in PREFIX_TYPE_MAP (mirrors CoDD validator.py lines 320-324)
    const nodeIdValid =
      /^[a-z_]+:.+$/.test(rawNodeId) &&
      Object.keys(PREFIX_TYPE_MAP).some(p => rawNodeId.startsWith(p));
    if (!nodeIdValid) {
      console.warn(`[vcsdd-coherence] Skipping spec "${relPath}": invalid node_id "${rawNodeId}" (must match <prefix>:<name> with a known prefix)`);
      continue;
    }
    const nodeId = rawNodeId;
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
      addEdge(ceg, sourceId, nodeId, relation, 'governance', [{
        sourceType: 'frontmatter', method: 'frontmatter',
        score: FRONTMATTER_SCORES.depended_by,
        detail: `Declared in ${relPath} depended_by`, isNegative: false,
      }]);
    }

    // conventions: must_review edges (CoDD semantic)
    for (const conv of (coherence.conventions ?? [])) {
      const targets = Array.isArray(conv.targets) ? conv.targets
        : (typeof conv.targets === 'string' ? [conv.targets] : []);
      for (const targetId of targets) {
        if (!targetId) continue;
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
      upsertNode(ceg, depId, { type: 'db_column', name: `${table}.${column}` });
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
      upsertNode(ceg, fileNodeId, { type: 'file', path: safePath });
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
  generateImpactReport,

  // Cycle detection & validation
  detectCycles,
  validateCoherence,

  // Frontmatter
  extractFrontmatter,
  scanSpecFrontmatter,
  rebuildFromFrontmatter,

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
