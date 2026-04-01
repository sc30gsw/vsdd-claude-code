'use strict';

/**
 * Regression tests for scripts/lib/vcsdd-coherence.js
 *
 * Covers the three bugs fixed in the CoDD integration:
 *   1. parseMinimalYaml: coherence: as nested map (not array)
 *   2. propagateImpact: confidence NOT stored during BFS
 *   3. generateImpactReport: band classification from edge lookup (not path.length)
 *
 * Also covers: calculateConfidence, detectCycles, validateCoherence,
 * removeAutoEvidence, sanitizeRelativePath.
 *
 * Mirrors CoDD reference test cases from codd-dev/tests/test_graph.py.
 */

const {
  classifyBand,
  calculateConfidence,
  propagateImpact,
  impactNodeIncomingStats,
  generateImpactReport,
  detectCycles,
  validateCoherence,
  removeAutoEvidence,
  upsertNode,
  addEdge,
  extractFrontmatter,
  sanitizeRelativePath,
  DEFAULT_BANDS,
} = require('../scripts/lib/vcsdd-coherence');

// ── Minimal test harness ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

// ── Helper: build minimal CEG ─────────────────────────────────────────────────

function makeCeg(nodes, edges) {
  const nodeMap = {};
  for (const n of nodes) nodeMap[n.id] = n;
  return { version: '1', nodes: nodeMap, edges };
}

function makeEdge(sourceId, targetId, confidence, evidenceCount = 1) {
  const evidence = [];
  for (let i = 0; i < evidenceCount; i++) {
    evidence.push({ sourceType: 'frontmatter', method: 'frontmatter', score: 0.9, isNegative: false });
  }
  return {
    id:         `${sourceId}--${targetId}`,
    sourceId,
    targetId,
    relation:   'depends_on',
    semantic:   'governance',
    confidence,
    isActive:   true,
    evidence,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. classifyBand — mirrors CoDD test_graph.py
// ══════════════════════════════════════════════════════════════════════════════

section('classifyBand (CoDD test_graph.py parity)');

assertEqual(classifyBand(0.95, 3), 'green',  '0.95 confidence + 3 evidence → green');
assertEqual(classifyBand(0.95, 1), 'amber',  '0.95 confidence + 1 evidence → amber (insufficient evidence)');
assertEqual(classifyBand(0.60, 5), 'amber',  '0.60 confidence + 5 evidence → amber (below green threshold)');
assertEqual(classifyBand(0.30, 1), 'gray',   '0.30 confidence + 1 evidence → gray');
assertEqual(classifyBand(0.90, 2), 'green',  '0.90 confidence + 2 evidence → green (exact threshold)');
assertEqual(classifyBand(0.89, 2), 'amber',  '0.89 confidence + 2 evidence → amber (just below green)');

// ══════════════════════════════════════════════════════════════════════════════
// 2. extractFrontmatter / parseMinimalYaml — Bug 1 fix
// ══════════════════════════════════════════════════════════════════════════════

section('extractFrontmatter — coherence: nested map (Bug 1)');

const frontmatterDoc = `---
coherence:
  node_id: "design:api-design"
  type: design
  name: "API Design"
  depends_on:
    - id: "design:system-design"
      relation: derives_from
    - id: "req:requirements-v1"
      relation: implements
  source_files:
    - "src/api/routes.ts"
---

# API Design

Some content here.
`;

const fm = extractFrontmatter(frontmatterDoc);

// extractFrontmatter returns parsed.coherence directly (the inner map object)
assert(fm !== null,            'frontmatter is parsed (not null)');
assert(!Array.isArray(fm),     'coherence is a map (not an array) — Bug 1 fix');
assertEqual(
  fm.node_id,
  'design:api-design',
  'node_id is correctly parsed'
);
assertEqual(
  fm.type,
  'design',
  'type is correctly parsed'
);
assertEqual(
  fm.name,
  'API Design',
  'name is correctly parsed'
);
assert(
  Array.isArray(fm.depends_on),
  'depends_on is an array'
);
assertEqual(
  fm.depends_on.length,
  2,
  'depends_on has 2 entries'
);
assertEqual(
  fm.depends_on[0].id,
  'design:system-design',
  'depends_on[0].id is correct'
);
assertEqual(
  fm.depends_on[0].relation,
  'derives_from',
  'depends_on[0].relation is correct'
);
assert(
  Array.isArray(fm.source_files),
  'source_files is an array'
);
assertEqual(
  fm.source_files[0],
  'src/api/routes.ts',
  'source_files[0] is correct'
);

section('extractFrontmatter — depends_on-only map (array key under map)');

const depOnlyDoc = `---
coherence:
  node_id: "test:strategy"
  depends_on:
    - id: "design:api-design"
---
`;

const fm2 = extractFrontmatter(depOnlyDoc);
assert(!Array.isArray(fm2),           'coherence is still a map with depends_on subkey');
assertEqual(fm2.node_id,              'test:strategy', 'node_id parsed correctly');
assertEqual(fm2.depends_on[0].id,     'design:api-design', 'depends_on[0].id correct');

// ══════════════════════════════════════════════════════════════════════════════
// 3. propagateImpact — Bug 2 fix: no confidence field in visited
// ══════════════════════════════════════════════════════════════════════════════

section('propagateImpact — chain a→b→c→d (CoDD test_graph.py parity)');

// Chain: a depends_on b depends_on c depends_on d
// When d changes, impact reaches c (depth 1), b (depth 2), a (depth 3)
const chainCeg = makeCeg(
  [
    { id: 'a', type: 'design', name: 'A' },
    { id: 'b', type: 'design', name: 'B' },
    { id: 'c', type: 'design', name: 'C' },
    { id: 'd', type: 'design', name: 'D' },
  ],
  [
    makeEdge('a', 'b', 0.9),
    makeEdge('b', 'c', 0.9),
    makeEdge('c', 'd', 0.9),
  ],
);

const impacts = propagateImpact(chainCeg, ['d']);

assert(impacts.has('c'), 'c is impacted (depth 1)');
assert(impacts.has('b'), 'b is impacted (depth 2)');
assert(impacts.has('a'), 'a is impacted (depth 3)');
assert(!impacts.has('d'), 'd (start node) is excluded from results');

assertEqual(impacts.get('c').depth, 1, 'c has depth 1');
assertEqual(impacts.get('b').depth, 2, 'b has depth 2');
assertEqual(impacts.get('a').depth, 3, 'a has depth 3');

// Bug 2 fix: visited entries must NOT have a confidence field
const visitedA = impacts.get('a');
assert(
  visitedA.confidence === undefined,
  'visited entry has no confidence field (Bug 2 fix — confidence resolved at report time)'
);

section('propagateImpact — maxDepth respected');

const deepImpacts = propagateImpact(chainCeg, ['d'], 2);
assert(deepImpacts.has('c'), 'c (depth 1) included within maxDepth=2');
assert(deepImpacts.has('b'), 'b (depth 2) included within maxDepth=2');
assert(!deepImpacts.has('a'), 'a (depth 3) excluded by maxDepth=2');

section('impactNodeIncomingStats — incoming active edges to node');

{
  const sCeg = {
    version: '1',
    nodes: { x: { type: 'design' }, y: { type: 'design' } },
    edges: [
      { id: 1, sourceId: 'x', targetId: 'y', relation: 'depends_on', semantic: 'governance',
        confidence: 0.85, isActive: true, evidence: [] },
      { id: 2, sourceId: 'x', targetId: 'y', relation: 'depends_on', semantic: 'governance',
        confidence: 0.95, isActive: true, evidence: [] },
      { id: 3, sourceId: 'z', targetId: 'y', relation: 'depends_on', semantic: 'governance',
        confidence: 0.5, isActive: false, evidence: [] },
    ],
  };
  const st = impactNodeIncomingStats(sCeg, 'y');
  assertEqual(st.evidenceCount, 2, 'only active incoming edges count');
  assertEqual(st.maxConfidence, 0.95, 'max confidence among active incoming');
  const st2 = impactNodeIncomingStats(sCeg, 'x');
  assertEqual(st2.evidenceCount, 0, 'no incoming to x');
  assertEqual(st2.maxConfidence, 0, 'maxConfidence 0 when no incoming');
}


// ══════════════════════════════════════════════════════════════════════════════
// 4. generateImpactReport — Bug 3 fix: evidence-based band classification
// ══════════════════════════════════════════════════════════════════════════════

section('generateImpactReport — single incoming evidence → Amber (not Green)');

// Band is classified from INCOMING edges to the impacted node
// (mirrors CoDD propagate.py:240-244: ceg.get_incoming_edges(target_id)).
//
// X depends on Y (X→Y). When Y changes, X is impacted.
// Z depends on X (Z→X) — 1 incoming edge to X, confidence 0.95.
// evidenceCount=1 → classifyBand(0.95, 1) = amber (not green)
const singleEvCeg = makeCeg(
  [
    { id: 'X', type: 'design', name: 'X Doc' },
    { id: 'Y', type: 'design', name: 'Y Doc' },
    { id: 'Z', type: 'design', name: 'Z Doc' },
  ],
  [
    makeEdge('X', 'Y', 0.95, 1),  // X depends on Y (propagation edge)
    makeEdge('Z', 'X', 0.95, 1),  // Z depends on X (1 incoming edge to X)
  ],
);

const singleEvImpacts = propagateImpact(singleEvCeg, ['Y']);
const singleEvReport  = generateImpactReport(singleEvImpacts, singleEvCeg);

assert(
  singleEvReport.includes('🟡 Amber'),
  '1 incoming edge + 0.95 confidence → Amber (not Green)'
);
assert(
  !singleEvReport.includes('🟢 Green'),
  '1 incoming edge does NOT produce Green band'
);

section('generateImpactReport — 2+ incoming edges with high confidence IS Green');

// P depends on R (P→R). When R changes, P is impacted.
// S and T both depend on P (S→P, T→P) — 2 incoming edges to P with conf >= 0.90.
// evidenceCount=2, maxConf=0.92 → classifyBand(0.92, 2) = green
const multiEvCeg = makeCeg(
  [
    { id: 'P', type: 'design', name: 'P Doc' },
    { id: 'R', type: 'design', name: 'R Doc' },
    { id: 'S', type: 'design', name: 'S Doc' },
    { id: 'T', type: 'design', name: 'T Doc' },
  ],
  [
    makeEdge('P', 'R', 0.91, 1),  // P depends on R (propagation edge)
    makeEdge('S', 'P', 0.92, 1),  // S depends on P — incoming edge to P
    makeEdge('T', 'P', 0.91, 1),  // T depends on P — incoming edge to P
  ],
);

// When R changes, P is impacted. P has 2 incoming edges (S→P, T→P) → evidenceCount=2
const multiEvImpacts = propagateImpact(multiEvCeg, ['R']);
const multiEvReport  = generateImpactReport(multiEvImpacts, multiEvCeg);

assert(
  multiEvReport.includes('🟢 Green'),
  '2 incoming edges + confidence >= 0.90 → Green'
);

section('generateImpactReport — source_files outgoing edges do NOT inflate band to Green');

// Regression: outgoing extracted_from (source_files) edges must NOT be counted
// as incoming evidence. Only edges pointing TO the impacted node count.
//
// P depends on R (P→R). When R changes, P is impacted.
// Only 1 node depends on P (Q→P, confidence 0.95) — 1 incoming edge.
// P also has 2 outgoing extracted_from edges to file nodes (noise).
// Expected: evidenceCount=1 → Amber (not Green)
const srcFilesCeg = makeCeg(
  [
    { id: 'P',      type: 'design', name: 'P Doc' },
    { id: 'Q',      type: 'design', name: 'Q Doc' },
    { id: 'R',      type: 'design', name: 'R Doc' },
    { id: 'file:a', type: 'file',   name: 'a.ts' },
    { id: 'file:b', type: 'file',   name: 'b.ts' },
  ],
  [
    makeEdge('P',      'R',      0.91, 1),  // P depends on R (propagation edge)
    makeEdge('Q',      'P',      0.95, 1),  // Q depends on P — 1 incoming edge
    { ...makeEdge('P', 'file:a', 0.90, 1), relation: 'extracted_from' },
    { ...makeEdge('P', 'file:b', 0.90, 1), relation: 'extracted_from' },
  ],
);

const srcFilesImpacts = propagateImpact(srcFilesCeg, ['R']);
const srcFilesReport  = generateImpactReport(srcFilesImpacts, srcFilesCeg);

assert(
  srcFilesReport.includes('🟡 Amber'),
  '1 incoming dep edge + 2 outgoing extracted_from → Amber (outgoing not counted)'
);
assert(
  !srcFilesReport.includes('🟢 Green'),
  'source_files outgoing edges do NOT push band to Green'
);

// ══════════════════════════════════════════════════════════════════════════════
// 5. parseMinimalYaml — empty array key followed by sibling key
// ══════════════════════════════════════════════════════════════════════════════

section('extractFrontmatter — empty depends_on: followed by sibling source_files:');

// Regression for the empty-array lookahead indent bug.
// When depends_on: has no items and source_files: is a sibling at the same
// indent, the lookahead used to see `source_files:` (not `- `), decide
// nextIsArray=false, and create depends_on as {} (an object).
// rebuildFromFrontmatter then tries `for...of coherence.depends_on` and throws.
const emptyDepOnDoc = `---
coherence:
  node_id: "test:empty-deps"
  type: design
  depends_on:
  source_files:
    - src/a.ts
---
`;

const fm3 = extractFrontmatter(emptyDepOnDoc);

assert(fm3 !== null, 'frontmatter with empty depends_on is parsed (not null)');
assert(Array.isArray(fm3.depends_on), 'empty depends_on: is an array (not an object)');
assertEqual(fm3.depends_on.length, 0, 'empty depends_on: has length 0');
assert(Array.isArray(fm3.source_files), 'source_files is still parsed as an array');
assertEqual(fm3.source_files[0], 'src/a.ts', 'source_files[0] is correct');

section('extractFrontmatter — all known list keys empty at end of frontmatter');

// All five known list keys (depends_on, depended_by, conventions,
// data_dependencies, source_files) empty, with no following siblings.
// Each should default to [] rather than {}.
const allEmptyListsDoc = `---
coherence:
  node_id: "test:all-empty"
  depends_on:
  depended_by:
  source_files:
---
`;

const fm4 = extractFrontmatter(allEmptyListsDoc);

assert(Array.isArray(fm4.depends_on),    'depends_on empty at EOF → []');
assert(Array.isArray(fm4.depended_by),   'depended_by empty at EOF → []');
assert(Array.isArray(fm4.source_files),  'source_files empty at EOF → []');

// ══════════════════════════════════════════════════════════════════════════════
// 6. calculateConfidence — Noisy-OR formula (mirrors CoDD _noisy_or)
// ══════════════════════════════════════════════════════════════════════════════

section('calculateConfidence — Noisy-OR formula');

// Empty evidence → 0 (posProduct=1, negProduct=1 → 1-1=0)
assertEqual(calculateConfidence([]), 0, 'empty evidence → 0');

// Single positive evidence 0.9 → 1-(1-0.9) = 0.9
assertEqual(
  calculateConfidence([{ score: 0.9, isNegative: false }]),
  0.9,
  'single positive 0.9 → 0.9'
);

// Two positive evidences 0.9 + 0.8 → 1-(0.1*0.2) = 0.98
assertEqual(
  calculateConfidence([
    { score: 0.9, isNegative: false },
    { score: 0.8, isNegative: false },
  ]),
  0.98,
  'two positives 0.9+0.8 → 0.98'
);

// Single negative evidence alone → max(0, 0.1 - 1.0) = 0
// negProduct = 0.1, posProduct = 1.0, raw = 0.1-1.0 = -0.9 → 0
assertEqual(
  calculateConfidence([{ score: 0.9, isNegative: true }]),
  0,
  'single negative evidence alone → 0 (clamped at 0)'
);

// Positive 0.9 + negative 0.7: posProduct=0.1, negProduct=0.3, raw=0.3-0.1=0.2
assertEqual(
  calculateConfidence([
    { score: 0.9, isNegative: false },
    { score: 0.7, isNegative: true },
  ]),
  0.2,
  'positive 0.9 + negative 0.7 → 0.2'
);

// Score clamping: score > 1 treated as 1 → posProduct = (1-1.0)=0 → conf = negProduct - 0
// With no negatives: posProduct=0, raw = negProduct(1) - posProduct(0) = 1
assertEqual(
  calculateConfidence([{ score: 9999, isNegative: false }]),
  1,
  'score > 1 clamped to 1 → confidence 1.0'
);

// Rounding to 4 decimal places
const threePositives = calculateConfidence([
  { score: 0.9, isNegative: false },
  { score: 0.7, isNegative: false },
  { score: 0.5, isNegative: false },
]);
// 1-(0.1*0.3*0.5) = 1-0.015 = 0.985
assertEqual(threePositives, 0.985, 'three positives 0.9+0.7+0.5 → 0.985');

// ══════════════════════════════════════════════════════════════════════════════
// 7. detectCycles — iterative DFS cycle detection
// ══════════════════════════════════════════════════════════════════════════════

section('detectCycles — no cycles');

const noCycleCeg = makeCeg(
  [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  [makeEdge('a', 'b', 0.9), makeEdge('b', 'c', 0.9)],
);
assertEqual(detectCycles(noCycleCeg), [], 'DAG has no cycles');

section('detectCycles — simple two-node cycle');

const twoCycleCeg = makeCeg(
  [{ id: 'a' }, { id: 'b' }],
  [makeEdge('a', 'b', 0.9), makeEdge('b', 'a', 0.9)],
);
const twoCycles = detectCycles(twoCycleCeg);
assert(twoCycles.length === 1, 'two-node cycle detected exactly once');
assert(twoCycles[0] === 'a -> b -> a', `canonical form is "a -> b -> a" (got: ${twoCycles[0]})`);

section('detectCycles — three-node cycle');

const threeCycleCeg = makeCeg(
  [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  [makeEdge('a', 'b', 0.9), makeEdge('b', 'c', 0.9), makeEdge('c', 'a', 0.9)],
);
const threeCycles = detectCycles(threeCycleCeg);
assert(threeCycles.length === 1, 'three-node cycle detected exactly once');
assert(threeCycles[0] === 'a -> b -> c -> a', `canonical form is "a -> b -> c -> a" (got: ${threeCycles[0]})`);

section('detectCycles — inactive edges ignored');

const inactiveCycleCeg = makeCeg(
  [{ id: 'a' }, { id: 'b' }],
  [
    makeEdge('a', 'b', 0.9),
    { ...makeEdge('b', 'a', 0.9), isActive: false },  // inactive back-edge
  ],
);
assertEqual(detectCycles(inactiveCycleCeg), [], 'inactive edges do not form cycles');

// ══════════════════════════════════════════════════════════════════════════════
// 8. validateCoherence — reference integrity + cycle detection
// ══════════════════════════════════════════════════════════════════════════════

section('validateCoherence — clean graph');

const cleanCeg = makeCeg(
  [{ id: 'a' }, { id: 'b' }],
  [makeEdge('a', 'b', 0.9)],
);
const cleanResult = validateCoherence(cleanCeg);
assert(cleanResult.ok === true, 'clean graph → ok: true');
assertEqual(cleanResult.warnings, [], 'clean graph → no warnings');
assertEqual(cleanResult.cycles, [], 'clean graph → no cycles');

section('validateCoherence — dangling reference warns');

const danglingCeg = makeCeg(
  [{ id: 'a' }],
  [makeEdge('a', 'ghost', 0.9)],  // 'ghost' is not in nodes
);
const danglingResult = validateCoherence(danglingCeg);
assert(danglingResult.ok === true, 'dangling ref → ok: true (warning only, not failure)');
assert(danglingResult.warnings.length > 0, 'dangling ref → at least one warning');
assert(
  danglingResult.warnings.some(w => w.includes('ghost')),
  'warning mentions missing node "ghost"'
);

section('validateCoherence — cycle → ok: false');

const cycleCeg = makeCeg(
  [{ id: 'x' }, { id: 'y' }],
  [makeEdge('x', 'y', 0.9), makeEdge('y', 'x', 0.9)],
);
const cycleResult = validateCoherence(cycleCeg);
assert(cycleResult.ok === false, 'cycle graph → ok: false');
assert(typeof cycleResult.reason === 'string', 'cycle result has reason string');
assert(cycleResult.reason.includes('Circular'), 'reason mentions "Circular"');
assert(cycleResult.cycles.length > 0, 'cycles array is non-empty');

// ══════════════════════════════════════════════════════════════════════════════
// 9. removeAutoEvidence — purge auto, preserve human
// ══════════════════════════════════════════════════════════════════════════════

section('removeAutoEvidence — removes auto evidence, keeps human');

function makeCegWithEvidence(nodes, edges) {
  const nodeMap = {};
  for (const n of nodes) nodeMap[n.id] = n;
  return { version: '1', nodes: nodeMap, edges };
}

const autoHumanCeg = makeCegWithEvidence(
  [{ id: 'a', type: 'design' }, { id: 'b', type: 'design' }],
  [{
    id: 1, sourceId: 'a', targetId: 'b',
    relation: 'depends_on', semantic: 'governance',
    confidence: 0.95, isActive: true,
    evidence: [
      { sourceType: 'frontmatter', method: 'frontmatter', score: 0.9, isNegative: false },
      { sourceType: 'human',       method: 'manual',      score: 0.8, isNegative: false },
    ],
  }],
);

removeAutoEvidence(autoHumanCeg);
assert(autoHumanCeg.edges.length === 1, 'edge survives (human evidence remains)');
assertEqual(autoHumanCeg.edges[0].evidence.length, 1, 'auto evidence removed, 1 human remains');
assertEqual(autoHumanCeg.edges[0].evidence[0].sourceType, 'human', 'remaining evidence is human');

section('removeAutoEvidence — edge with only auto evidence is deleted');

const autoOnlyCeg = makeCegWithEvidence(
  [{ id: 'a', type: 'design' }, { id: 'b', type: 'design' }],
  [{
    id: 1, sourceId: 'a', targetId: 'b',
    relation: 'depends_on', semantic: 'governance',
    confidence: 0.9, isActive: true,
    evidence: [
      { sourceType: 'frontmatter', method: 'frontmatter', score: 0.9, isNegative: false },
      { sourceType: 'static',      method: 'ast',         score: 0.8, isNegative: false },
    ],
  }],
);

removeAutoEvidence(autoOnlyCeg);
assertEqual(autoOnlyCeg.edges.length, 0, 'edge deleted when all evidence is auto');

section('removeAutoEvidence — orphan file: nodes are removed');

const orphanCeg = makeCegWithEvidence(
  [
    { id: 'a', type: 'design' },
    { id: 'b', type: 'design' },
    { id: 'file:x.ts', type: 'file' },  // orphan after edge deletion
  ],
  [{
    id: 1, sourceId: 'a', targetId: 'b',
    relation: 'depends_on', semantic: 'governance',
    confidence: 0.9, isActive: true,
    evidence: [
      { sourceType: 'human', method: 'manual', score: 0.9, isNegative: false },
    ],
  }],
  // note: file:x.ts has no edges at all
);

removeAutoEvidence(orphanCeg);
assert(!orphanCeg.nodes['file:x.ts'], 'orphan file: node removed');
assert(orphanCeg.nodes['a'],          'non-orphan node a preserved');
assert(orphanCeg.nodes['b'],          'non-orphan node b preserved');

section('removeAutoEvidence — orphan non-file: nodes are also removed (Bug 1 fix)');

// Bug 1 fix: previously only file: prefix orphans were removed.
// After purging auto evidence, any unreferenced node (module:, design:, req:, etc.)
// must also be deleted, matching the reference CoDD implementation.
const orphanNonFileCeg = makeCegWithEvidence(
  [
    { id: 'a',          type: 'design' },
    { id: 'b',          type: 'design' },
    { id: 'module:old', type: 'module' },  // orphan — no edges reference it
    { id: 'req:stale',  type: 'requirement' },  // orphan — no edges reference it
  ],
  [{
    id: 1, sourceId: 'a', targetId: 'b',
    relation: 'depends_on', semantic: 'governance',
    confidence: 0.9, isActive: true,
    evidence: [
      { sourceType: 'human', method: 'manual', score: 0.9, isNegative: false },
    ],
  }],
);

removeAutoEvidence(orphanNonFileCeg);
assert(!orphanNonFileCeg.nodes['module:old'], 'orphan module: node removed (Bug 1 fix)');
assert(!orphanNonFileCeg.nodes['req:stale'],  'orphan req: node removed (Bug 1 fix)');
assert(orphanNonFileCeg.nodes['a'],           'non-orphan design node a preserved');
assert(orphanNonFileCeg.nodes['b'],           'non-orphan design node b preserved');

// ══════════════════════════════════════════════════════════════════════════════
// 10. sanitizeRelativePath — path traversal prevention
// ══════════════════════════════════════════════════════════════════════════════

section('sanitizeRelativePath — valid and invalid paths');

assertEqual(sanitizeRelativePath('src/app.ts'),        'src/app.ts',  'simple relative path passes');
assertEqual(sanitizeRelativePath('a/b/c.ts'),          'a/b/c.ts',    'nested relative path passes');
assertEqual(sanitizeRelativePath('file.ts'),            'file.ts',     'root-level relative path passes');
assertEqual(sanitizeRelativePath('/etc/passwd'),        null,          'absolute path rejected');
assertEqual(sanitizeRelativePath('../etc/passwd'),      null,          'path traversal rejected');
assertEqual(sanitizeRelativePath('../../etc/shadow'),   null,          'deep path traversal rejected');
assertEqual(sanitizeRelativePath(42),                   null,          'non-string rejected');

// ══════════════════════════════════════════════════════════════════════════════
// 11. data_dependencies topology — intermediate db_column node (Bug 2 fix)
// ══════════════════════════════════════════════════════════════════════════════

section('data_dependencies — intermediate db_column node created (Bug 2 fix)');

// Creates db_column:{table}.{column} as intermediate node with edges aligned to
// VCSDD's semantics: edge(A, B) = "A depends_on B".
//
// Correct topology (Bug 2 fix):
//   design:user-service --behavioral_dependency--> db_column:users.email
//   design:api-design   --behavioral_dependency--> db_column:users.email
//
// Both declaring doc AND affected items point TO the db_column node,
// so BFS via incoming edges from db_column surfaces all dependents.
// Previously, VCSDD created a direct edge from declaring doc to affected targets.
{
  const depCeg = { version: '1', nodes: {}, edges: [] };
  const docNodeId = 'design:user-service';
  upsertNode(depCeg, docNodeId, { type: 'design', name: 'User Service' });

  const dep   = { table: 'users', column: 'email', affects: ['design:api-design'], condition: '' };
  const depId = `db_column:${dep.table}.${dep.column}`;
  upsertNode(depCeg, depId, { type: 'db_column', name: `${dep.table}.${dep.column}` });
  // edge(docNodeId, depId): declaring doc depends_on db_column
  addEdge(depCeg, docNodeId, depId, 'behavioral_dependency', 'behavioral', [{
    sourceType: 'frontmatter', method: 'data_dependency', score: 0.75, isNegative: false,
  }]);
  for (const targetId of dep.affects) {
    upsertNode(depCeg, targetId, { type: 'design', name: targetId });
    // edge(targetId, depId): affected item depends_on db_column (Bug 2 fix)
    addEdge(depCeg, targetId, depId, 'behavioral_dependency', 'behavioral', [{
      sourceType: 'frontmatter', method: 'data_dependency', score: 0.75, isNegative: false,
    }]);
  }

  assert(depCeg.nodes['db_column:users.email'] !== undefined,
    'intermediate db_column:users.email node exists (Bug 2 fix)');
  assert(depCeg.edges.some(e => e.sourceId === docNodeId && e.targetId === 'db_column:users.email'),
    'declaring doc → db_column edge exists');
  assert(depCeg.edges.some(e => e.sourceId === 'design:api-design' && e.targetId === 'db_column:users.email'),
    'affected item → db_column edge exists (correct direction for BFS)');
  assert(!depCeg.edges.some(e => e.sourceId === docNodeId && e.targetId === 'design:api-design'),
    'no direct declaring doc → affected target edge (topology fix)');

  // BFS from db_column (following incoming edges) finds all dependents
  const depImpacts = propagateImpact(depCeg, ['db_column:users.email']);
  assert(depImpacts.has(docNodeId),
    'impact propagates to declaring doc when db_column changes');
  assert(depImpacts.has('design:api-design'),
    'impact propagates to affected item when db_column changes (Bug 2 fix)');
}

// ══════════════════════════════════════════════════════════════════════════════
// Results
// ══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
