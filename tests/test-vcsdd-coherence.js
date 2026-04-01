'use strict';

/**
 * Regression tests for scripts/lib/vcsdd-coherence.js
 *
 * Covers the three bugs fixed in the CoDD integration:
 *   1. parseMinimalYaml: coherence: as nested map (not array)
 *   2. propagateImpact: confidence NOT stored during BFS
 *   3. generateImpactReport: band classification from edge lookup (not path.length)
 *
 * Mirrors CoDD reference test cases from codd-dev/tests/test_graph.py.
 */

const {
  classifyBand,
  propagateImpact,
  generateImpactReport,
  extractFrontmatter,
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

// ══════════════════════════════════════════════════════════════════════════════
// 4. generateImpactReport — Bug 3 fix: evidence-based band classification
// ══════════════════════════════════════════════════════════════════════════════

section('generateImpactReport — single evidence should NOT be Green (Bug 3)');

// Node X depends on Y with 1 edge, confidence 0.95
// Without fix: path.length=2 → classifyBand(0.95, 2) = green (2 >= minEvidenceCount)
// With fix:    evidenceCount=1 → classifyBand(0.95, 1) = amber
const singleEvCeg = makeCeg(
  [
    { id: 'X', type: 'design', name: 'X Doc' },
    { id: 'Y', type: 'design', name: 'Y Doc' },
  ],
  [makeEdge('X', 'Y', 0.95, 1)],
);

const singleEvImpacts = propagateImpact(singleEvCeg, ['Y']);
const singleEvReport  = generateImpactReport(singleEvImpacts, singleEvCeg);

assert(
  singleEvReport.includes('🟡 Amber'),
  'single evidence + 0.95 confidence → Amber (not Green) (Bug 3 fix)'
);
assert(
  !singleEvReport.includes('🟢 Green'),
  'single evidence does NOT produce Green band (Bug 3 fix)'
);

section('generateImpactReport — 2+ evidence with high confidence IS Green');

// Node X depends on Y with 2 edges (2 evidence entries in single edge is not sufficient;
// evidenceCount = number of active edges from X).  Add a second edge for X.
const multiEvCeg = makeCeg(
  [
    { id: 'P', type: 'design', name: 'P Doc' },
    { id: 'Q', type: 'design', name: 'Q Doc' },
    { id: 'R', type: 'design', name: 'R Doc' },
  ],
  [
    makeEdge('P', 'Q', 0.92, 1),
    makeEdge('P', 'R', 0.91, 1),  // P has 2 active outgoing edges
  ],
);

// When R changes, P is impacted. P has 2 active outgoing edges → evidenceCount=2
const multiEvImpacts = propagateImpact(multiEvCeg, ['R']);
const multiEvReport  = generateImpactReport(multiEvImpacts, multiEvCeg);

assert(
  multiEvReport.includes('🟢 Green'),
  '2 active edges + confidence >= 0.90 → Green'
);

// ══════════════════════════════════════════════════════════════════════════════
// Results
// ══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
