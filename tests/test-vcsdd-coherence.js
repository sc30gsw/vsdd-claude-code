'use strict';

/**
 * Regression tests for scripts/lib/vcsdd-coherence.js
 *
 * Covers the bugs fixed in the CoDD integration:
 *   1. parseMinimalYaml: coherence: as nested map (not array)
 *   2. propagateImpact: confidence NOT stored during BFS
 *   3. generateImpactReport: band classification from edge lookup (not path.length)
 *   4. scanSpecFrontmatter: recursive directory traversal (subdirectory support)
 *   5. rebuildFromFrontmatter: node_id format validation (prefix + pattern check)
 *   6. addEdge: semantic field included in deduplication key
 *
 * Also covers: calculateConfidence, detectCycles, validateCoherence,
 * removeAutoEvidence, sanitizeRelativePath.
 *
 * Mirrors CoDD reference test cases from codd-dev/tests/test_graph.py.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const childProcess = require('child_process');

const {
  classifyBand,
  calculateConfidence,
  propagateImpact,
  impactNodeIncomingStats,
  getConventionEdges,
  collectConventionAlerts,
  generateImpactReport,
  detectCycles,
  loadCoherenceWithStatus,
  validateCoherence,
  removeAutoEvidence,
  upsertNode,
  addEdge,
  extractFrontmatter,
  scanSpecFrontmatter,
  scanSpecFrontmatterDetailed,
  rebuildFromFrontmatter,
  refreshAndValidateCoherence,
  getChangedFilesFromGit,
  resolveChangedNodes,
  detectChangedNodes,
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

function runGit(args, cwd) {
  return childProcess.execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// ── Helper: build minimal CEG ─────────────────────────────────────────────────

let nextEdgeId = 1;

function makeCeg(nodes, edges) {
  const nodeMap = {};
  for (const n of nodes) nodeMap[n.id] = n;
  return { version: 1, nodes: nodeMap, edges };
}

function makeEdge(sourceId, targetId, confidence, evidenceCount = 1) {
  const evidence = [];
  for (let i = 0; i < evidenceCount; i++) {
    evidence.push({ sourceType: 'frontmatter', method: 'frontmatter', score: 0.9, isNegative: false });
  }
  return {
    id:         nextEdgeId++,
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
    version: 1,
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

section('generateImpactReport — convention alerts are rendered before impact bands');

const reportWithConventions = generateImpactReport(
  singleEvImpacts,
  singleEvCeg,
  DEFAULT_BANDS,
  {
    conventionAlerts: [
      {
        sourceNode: 'design:db',
        targetId: 'db:rls',
        targetName: 'RLS Guardrail',
        targetType: 'db_object',
        reason: 'Tenant isolation review',
        confidence: 0.8,
        triggeredByNodeId: 'design:db',
      },
    ],
  },
);

assert(
  reportWithConventions.includes('Convention Alerts'),
  'report includes a dedicated convention alert section',
);
assert(
  reportWithConventions.includes('RLS Guardrail'),
  'report includes convention alert target label',
);
assert(
  reportWithConventions.includes('Tenant isolation review'),
  'report includes convention alert reason',
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

section('extractFrontmatter — conventions targets: block list inside array item');

// Regression: conventions supports block-style targets list as documented in
// skills/vcsdd-coherence-scan/SKILL.md.
const conventionsDoc = `---
coherence:
  node_id: "design:conv-doc"
  type: design
  conventions:
    - targets:
        - "module:auth"
        - "module:billing"
      reason: "Policy applies"
---
`;

const fmConv = extractFrontmatter(conventionsDoc);
assert(fmConv !== null, 'conventions frontmatter parsed (not null)');
assert(Array.isArray(fmConv.conventions), 'conventions is an array');
assertEqual(fmConv.conventions.length, 1, 'conventions has 1 item');
assert(Array.isArray(fmConv.conventions[0].targets), 'conventions[0].targets is an array (block list parsed)');
assertEqual(
  fmConv.conventions[0].targets,
  ['module:auth', 'module:billing'],
  'conventions[0].targets preserves list items',
);
assertEqual(
  fmConv.conventions[0].reason,
  'Policy applies',
  'conventions[0].reason is parsed as sibling key',
);

section('rebuildFromFrontmatter — conventions targets block list creates must_review edges');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcsdd-coherence-test-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    const featureName = 'conv-edge-test';
    const featureDir = path.join(tmpDir, '.vcsdd', 'features', featureName);
    const specsDir = path.join(featureDir, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });

    fs.writeFileSync(path.join(specsDir, 'conv.md'), [
      '---',
      'coherence:',
      '  node_id: "design:conv-doc"',
      '  type: design',
      '  conventions:',
      '    - targets:',
      '        - "module:auth"',
      '      reason: "Policy applies"',
      '---',
      '# Conv',
    ].join('\n'));

    const ceg = rebuildFromFrontmatter(featureName);
    const mustReviewEdges = ceg.edges.filter(e =>
      e.sourceId === 'design:conv-doc' &&
      e.targetId === 'module:auth' &&
      e.relation === 'must_review' &&
      e.semantic === 'governance',
    );
    assert(mustReviewEdges.length === 1, 'conventions targets → must_review edge is created');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

section('getConventionEdges / collectConventionAlerts — direct must_review edges are surfaced');

{
  const directConventionCeg = makeCeg(
    [
      { id: 'design:db', type: 'design', name: 'Database Design' },
      { id: 'db:rls_policies', type: 'db_object', name: 'RLS Policies' },
      { id: 'db_table:audit_logs', type: 'db_table', name: 'Audit Logs' },
    ],
    [
      {
        id: 1,
        sourceId: 'design:db',
        targetId: 'db:rls_policies',
        relation: 'must_review',
        semantic: 'governance',
        confidence: 0.8,
        isActive: true,
        evidence: [
          { sourceType: 'frontmatter', method: 'convention', score: 0.8, detail: 'RLS required', isNegative: false },
        ],
      },
      {
        id: 2,
        sourceId: 'design:db',
        targetId: 'db_table:audit_logs',
        relation: 'must_review',
        semantic: 'governance',
        confidence: 0.8,
        isActive: true,
        evidence: [
          { sourceType: 'frontmatter', method: 'convention', score: 0.8, detail: 'Audit logs must be reviewed', isNegative: false },
        ],
      },
    ],
  );

  const directEdges = getConventionEdges(directConventionCeg, 'design:db');
  const directAlerts = collectConventionAlerts(directConventionCeg, ['design:db']);

  assertEqual(directEdges.length, 2, 'getConventionEdges returns both direct must_review edges');
  assertEqual(directAlerts.length, 2, 'collectConventionAlerts surfaces both direct must_review alerts');
  assert(
    directAlerts.some(alert => alert.targetId === 'db:rls_policies' && alert.reason === 'RLS required'),
    'direct convention alert keeps target id and reason',
  );
  assert(
    directAlerts.some(alert => alert.targetId === 'db_table:audit_logs' && alert.triggeredByNodeId === 'design:db'),
    'direct convention alert records triggering node',
  );
}

section('collectConventionAlerts — parent must_review edges are surfaced for changed child nodes');

{
  const parentConventionCeg = makeCeg(
    [
      { id: 'req:tenant-safety', type: 'requirement', name: 'Tenant Safety' },
      { id: 'design:db', type: 'design', name: 'Database Design' },
      { id: 'db:rls', type: 'db_object', name: 'RLS Guardrail' },
    ],
    [
      {
        id: 1,
        sourceId: 'req:tenant-safety',
        targetId: 'design:db',
        relation: 'depends_on',
        semantic: 'governance',
        confidence: 0.9,
        isActive: true,
        evidence: [
          { sourceType: 'frontmatter', method: 'frontmatter', score: 0.9, isNegative: false },
        ],
      },
      {
        id: 2,
        sourceId: 'req:tenant-safety',
        targetId: 'db:rls',
        relation: 'must_review',
        semantic: 'governance',
        confidence: 0.8,
        isActive: true,
        evidence: [
          { sourceType: 'frontmatter', method: 'convention', score: 0.8, detail: 'Tenant isolation review', isNegative: false },
        ],
      },
    ],
  );

  const parentAlerts = collectConventionAlerts(parentConventionCeg, ['design:db']);

  assertEqual(parentAlerts.length, 1, 'parent convention is surfaced for the changed child node');
  assertEqual(parentAlerts[0].sourceNode, 'req:tenant-safety', 'parent convention keeps parent source node');
  assertEqual(parentAlerts[0].targetId, 'db:rls', 'parent convention keeps must_review target');
  assertEqual(parentAlerts[0].triggeredByNodeId, 'design:db', 'parent convention records changed child node');
}

section('rebuildFromFrontmatter — module targets are concrete nodes, not placeholder errors');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcsdd-coherence-test-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    const featureName = 'module-targets-test';
    const featureDir = path.join(tmpDir, '.vcsdd', 'features', featureName);
    const specsDir = path.join(featureDir, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });

    fs.writeFileSync(path.join(specsDir, 'api.md'), [
      '---',
      'coherence:',
      '  node_id: "design:api-design"',
      '  type: design',
      '  depends_on:',
      '    - id: "design:system-design"',
      '  conventions:',
      '    - targets:',
      '        - "module:auth"',
      '      reason: "Auth policy applies"',
      '  data_dependencies:',
      '    - table: "users"',
      '      column: "tenant_id"',
      '      affects:',
      '        - "module:billing"',
      '---',
      '# API Design',
    ].join('\n'));

    fs.writeFileSync(path.join(specsDir, 'system.md'), [
      '---',
      'coherence:',
      '  node_id: "design:system-design"',
      '  type: design',
      '---',
      '# System Design',
    ].join('\n'));

    const ceg = rebuildFromFrontmatter(featureName);
    const result = validateCoherence(ceg);

    assert(ceg.nodes['module:auth'] !== undefined, 'module:auth node is materialised');
    assert(ceg.nodes['module:billing'] !== undefined, 'module:billing node is materialised');
    assert(ceg.nodes['module:auth'].placeholder === false, 'module:auth is concrete, not placeholder');
    assert(ceg.nodes['module:billing'].placeholder === false, 'module:billing is concrete, not placeholder');
    assert(result.ok === true, 'module targets do not fail coherence validation');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

section('rebuildFromFrontmatter — modules field links specs to implementation modules');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcsdd-coherence-test-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    const featureName = 'modules-field-test';
    const featureDir = path.join(tmpDir, '.vcsdd', 'features', featureName);
    const specsDir = path.join(featureDir, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });

    fs.writeFileSync(path.join(specsDir, 'auth.md'), [
      '---',
      'coherence:',
      '  node_id: "design:auth-detail"',
      '  type: design',
      '  modules:',
      '    - auth',
      '    - "module:session"',
      '---',
      '# Auth Detail',
    ].join('\n'));

    const ceg = rebuildFromFrontmatter(featureName);
    const result = validateCoherence(ceg);
    const impacts = propagateImpact(ceg, ['design:auth-detail']);

    assert(result.ok === true, 'modules field produces a valid coherence graph');
    assert(ceg.nodes['module:auth'] !== undefined, 'plain module name is normalized to module:auth');
    assert(ceg.nodes['module:session'] !== undefined, 'prefixed module name is preserved');
    assert(
      ceg.edges.some(e =>
        e.sourceId === 'module:auth' &&
        e.targetId === 'design:auth-detail' &&
        e.relation === 'implements' &&
        e.semantic === 'technical'),
      'module:auth -> design:auth-detail implements edge exists',
    );
    assert(impacts.has('module:auth'), 'spec change propagates to module:auth');
    assert(impacts.has('module:session'), 'spec change propagates to module:session');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

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

section('validateCoherence — dangling reference blocks');

const danglingCeg = makeCeg(
  [{ id: 'a' }],
  [makeEdge('a', 'ghost', 0.9)],  // 'ghost' is not in nodes
);
const danglingResult = validateCoherence(danglingCeg);
assert(danglingResult.ok === false, 'dangling ref → ok: false (reference integrity error)');
assert(danglingResult.errors.length > 0, 'dangling ref → at least one error');
assert(
  danglingResult.errors.some(w => w.includes('ghost')),
  'error mentions missing node "ghost"'
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
  return { version: 1, nodes: nodeMap, edges };
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
  const depCeg = { version: 1, nodes: {}, edges: [] };
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
// scanSpecFrontmatter — recursive directory traversal (BUG-1 fix)
// ══════════════════════════════════════════════════════════════════════════════

section('scanSpecFrontmatter recursive traversal');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcsdd-coherence-test-'));
  try {
    // Create specs/top.md at root level
    const specsDir = path.join(tmpDir, 'specs');
    fs.mkdirSync(specsDir);
    fs.writeFileSync(path.join(specsDir, 'top.md'), [
      '---',
      'coherence:',
      '  node_id: "req:top-level"',
      '  type: requirement',
      '  name: "Top Level"',
      '---',
      '# Top Level',
    ].join('\n'));

    // Create specs/sub/nested.md in a subdirectory
    const subDir = path.join(specsDir, 'sub');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'nested.md'), [
      '---',
      'coherence:',
      '  node_id: "design:nested"',
      '  type: design',
      '  name: "Nested Design"',
      '  depends_on:',
      '    - id: "req:top-level"',
      '---',
      '# Nested',
    ].join('\n'));

    // Also create a non-frontmatter md file to ensure it's skipped cleanly
    fs.writeFileSync(path.join(subDir, 'no-frontmatter.md'), '# No frontmatter here\n');

    const results = scanSpecFrontmatter(tmpDir);

    assert(results.length === 2, 'scanSpecFrontmatter finds both root and subdirectory spec files');
    assert(results.some(r => r.relPath === path.join('specs', 'top.md')), 'root-level spec found');
    assert(results.some(r => r.relPath === path.join('specs', 'sub', 'nested.md')), 'subdirectory spec found');
    assert(!results.some(r => r.relPath.includes('no-frontmatter')), 'files without coherence frontmatter are excluded');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// scanSpecFrontmatterDetailed / rebuildFromFrontmatter — node_id validation
// ══════════════════════════════════════════════════════════════════════════════

section('scanSpecFrontmatterDetailed / rebuildFromFrontmatter node_id validation');

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcsdd-coherence-test-'));
  try {
    // Recreate the directory structure expected by rebuildFromFrontmatter:
    //   <tmpFeatureDir> = .vcsdd/features/<name>  (simulated by tmpDir)
    // rebuildFromFrontmatter calls getFeaturePath(featureName) which resolves to
    //   .vcsdd/features/<featureName>/ relative to process.cwd()
    // To avoid depending on cwd, we test via scanSpecFrontmatter + manual node_id check.
    const specsDir = path.join(tmpDir, 'specs');
    fs.mkdirSync(specsDir);

    // Valid node_id — should be accepted
    fs.writeFileSync(path.join(specsDir, 'valid.md'), [
      '---',
      'coherence:',
      '  node_id: "req:valid-requirement"',
      '  type: requirement',
      '---',
      '# Valid',
    ].join('\n'));

    // Invalid node_id: no prefix colon
    fs.writeFileSync(path.join(specsDir, 'invalid-no-prefix.md'), [
      '---',
      'coherence:',
      '  node_id: "INVALID_NO_PREFIX"',
      '  type: requirement',
      '---',
      '# Invalid',
    ].join('\n'));

    // Invalid node_id: unknown prefix
    fs.writeFileSync(path.join(specsDir, 'invalid-unknown-prefix.md'), [
      '---',
      'coherence:',
      '  node_id: "unknown:some-node"',
      '  type: requirement',
      '---',
      '# Invalid prefix',
    ].join('\n'));

    const scanResult = scanSpecFrontmatterDetailed(tmpDir);
    const validEntries = scanSpecFrontmatter(tmpDir);

    assertEqual(scanResult.entries.length, 1, 'detailed scan keeps only valid coherence entries');
    assertEqual(scanResult.errors.length, 2, 'detailed scan reports both invalid node_id documents');
    assert(validEntries.length === 1, 'scanSpecFrontmatter returns only valid spec files');
    assert(scanResult.errors.some(e => e.includes('INVALID_NO_PREFIX')), 'invalid uppercase node_id is reported');
    assert(scanResult.errors.some(e => e.includes('unknown:some-node')), 'unknown-prefix node_id is reported');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// addEdge — semantic field included in deduplication (BUG-4 fix)
// ══════════════════════════════════════════════════════════════════════════════

section('addEdge semantic deduplication');

{
  const ceg = { version: 1, nodes: {}, edges: [] };
  upsertNode(ceg, 'req:a', { type: 'requirement' });
  upsertNode(ceg, 'design:b', { type: 'design' });

  const ev1 = [{ sourceType: 'frontmatter', method: 'frontmatter', score: 0.9, isNegative: false }];
  const ev2 = [{ sourceType: 'frontmatter', method: 'frontmatter', score: 0.8, isNegative: false }];

  // Add two edges with same source/target/relation but different semantics
  addEdge(ceg, 'req:a', 'design:b', 'depends_on', 'governance', ev1);
  addEdge(ceg, 'req:a', 'design:b', 'depends_on', 'behavioral', ev2);

  const govEdges = ceg.edges.filter(e =>
    e.sourceId === 'req:a' && e.targetId === 'design:b' && e.relation === 'depends_on' && e.semantic === 'governance',
  );
  const behEdges = ceg.edges.filter(e =>
    e.sourceId === 'req:a' && e.targetId === 'design:b' && e.relation === 'depends_on' && e.semantic === 'behavioral',
  );

  assert(govEdges.length === 1, 'governance-semantic edge is created as separate edge');
  assert(behEdges.length === 1, 'behavioral-semantic edge is created as separate edge');
  assert(ceg.edges.filter(e => e.sourceId === 'req:a' && e.targetId === 'design:b').length === 2,
    'two edges with different semantics exist independently (no merge)');

  // Same source/target/relation/semantic should still accumulate evidence (not create new edge)
  addEdge(ceg, 'req:a', 'design:b', 'depends_on', 'governance', ev2);
  assert(govEdges[0].evidence.length === 2, 'same-semantic duplicate accumulates evidence on existing edge');
  assert(ceg.edges.filter(e => e.sourceId === 'req:a' && e.targetId === 'design:b').length === 2,
    'evidence accumulation does not create a third edge');
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 11: Bug fixes — CoDD adversarial review (Bug 1, 2, 3, 4)
// ══════════════════════════════════════════════════════════════════════════════

// Bug 1: parseScalar() handles YAML flow sequences
{
  section('parseScalar / extractFrontmatter — depends_on: [] (inline empty array)');

  const docEmpty = [
    '---',
    'coherence:',
    '  node_id: "req:inline-empty"',
    '  type: requirement',
    '  depends_on: []',
    '---',
    '# body',
  ].join('\n');

  const fmEmpty = extractFrontmatter(docEmpty);
  assert(fmEmpty !== null, 'frontmatter parsed');
  assert(Array.isArray(fmEmpty.depends_on), 'depends_on: [] yields an array');
  assertEqual(fmEmpty.depends_on.length, 0, 'depends_on: [] has length 0');

  section('parseScalar / extractFrontmatter — depends_on: [req:a, req:b] (inline list)');

  const docList = [
    '---',
    'coherence:',
    '  node_id: "req:inline-list"',
    '  type: requirement',
    '  depends_on: [req:alpha, req:beta]',
    '---',
    '# body',
  ].join('\n');

  const fmList = extractFrontmatter(docList);
  assert(fmList !== null, 'frontmatter with inline list parsed');
  assert(Array.isArray(fmList.depends_on), 'depends_on: [a, b] yields an array');
  assertEqual(fmList.depends_on.length, 2, 'inline list has 2 items');
  assertEqual(fmList.depends_on[0], 'req:alpha', 'first item is req:alpha');
  assertEqual(fmList.depends_on[1], 'req:beta', 'second item is req:beta');

  section('parseScalar / extractFrontmatter — source_files: [] (inline empty)');

  const docSf = [
    '---',
    'coherence:',
    '  node_id: "req:sf-empty"',
    '  type: requirement',
    '  source_files: []',
    '---',
  ].join('\n');

  const fmSf = extractFrontmatter(docSf);
  assert(fmSf !== null, 'frontmatter with source_files: [] parsed');
  assert(Array.isArray(fmSf.source_files), 'source_files: [] yields an array');
  assertEqual(fmSf.source_files.length, 0, 'source_files: [] has length 0');
}

// Bug 2: validateCoherence() warns on placeholder nodes
{
  section('validateCoherence — placeholder node warnings (Bug 2)');

  const ceg = { version: 1, nodes: {}, edges: [] };
  // Scanned node (real document)
  upsertNode(ceg, 'req:real', { type: 'requirement', placeholder: false });
  // addEdge auto-creates 'req:ghost' as placeholder
  addEdge(ceg, 'req:real', 'req:ghost', 'depends_on', 'governance', [
    { sourceType: 'frontmatter', method: 'frontmatter', score: 0.9, isNegative: false },
  ]);

  assert(ceg.nodes['req:ghost'] !== undefined, 'auto-created node exists');
  assert(ceg.nodes['req:ghost'].placeholder === true, 'auto-created node is placeholder');
  assert(ceg.nodes['req:real'].placeholder === false, 'scanned node is not placeholder');

  const result = validateCoherence(ceg);
  assert(result.ok === false, 'placeholder ref → ok: false (reference integrity error)');
  assert(Array.isArray(result.errors), 'errors array returned');
  assert(
    result.errors.some(w => w.includes('req:ghost') && w.includes('placeholder')),
    'error mentions placeholder node req:ghost',
  );

  section('validateCoherence — no placeholder warnings when all nodes are real');

  const ceg2 = { version: 1, nodes: {}, edges: [] };
  upsertNode(ceg2, 'req:a', { type: 'requirement', placeholder: false });
  upsertNode(ceg2, 'design:b', { type: 'design', placeholder: false });
  addEdge(ceg2, 'req:a', 'design:b', 'depends_on', 'governance', [
    { sourceType: 'frontmatter', method: 'frontmatter', score: 0.9, isNegative: false },
  ]);
  // Nodes were created before addEdge, so they retain placeholder: false
  ceg2.nodes['req:a'].placeholder = false;
  ceg2.nodes['design:b'].placeholder = false;

  const result2 = validateCoherence(ceg2);
  assert(result2.ok === true, 'no failure when all nodes are real');
  assert(
    !result2.warnings.some(w => w.includes('placeholder')),
    'no placeholder warnings when all nodes are real',
  );
}

// Bug 4: loadCoherenceWithStatus — corruption recovery with backup
{
  section('loadCoherenceWithStatus — corrupted JSON creates .bak and returns status corrupted');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcsdd-coherence-corrupt-'));
  try {
    const featureDir = path.join(tmpDir, '.vcsdd', 'features', 'corrupt-test');
    fs.mkdirSync(featureDir, { recursive: true });
    const coherencePath = path.join(featureDir, 'coherence.json');
    fs.writeFileSync(coherencePath, '{invalid json!!!');

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const result = loadCoherenceWithStatus('corrupt-test');
      assert(result.ceg === null, 'corrupted file returns null ceg');
      assertEqual(result.status, 'corrupted', 'status is corrupted');
      assert(fs.existsSync(coherencePath + '.bak'), 'backup file .bak was created');
    } finally {
      process.chdir(origCwd);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  section('loadCoherenceWithStatus — missing file returns status not_found');

  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'vcsdd-coherence-notfound-'));
  try {
    const featureDir2 = path.join(tmpDir2, '.vcsdd', 'features', 'notfound-test');
    fs.mkdirSync(featureDir2, { recursive: true });
    // No coherence.json written

    const origCwd = process.cwd();
    process.chdir(tmpDir2);
    try {
      const result = loadCoherenceWithStatus('notfound-test');
      assert(result.ceg === null, 'missing file returns null ceg');
      assertEqual(result.status, 'not_found', 'status is not_found');
    } finally {
      process.chdir(origCwd);
    }
  } finally {
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  }
}

// Bug 5: refreshAndValidateCoherence — validates current frontmatter, not stale coherence.json
{
  section('refreshAndValidateCoherence — rebuilds before validating stale coherence.json');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcsdd-coherence-rebuild-'));
  try {
    const featureDir = path.join(tmpDir, '.vcsdd', 'features', 'refresh-validate-test');
    const specsDir = path.join(featureDir, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });

    fs.writeFileSync(path.join(specsDir, 'behavioral-spec.md'), [
      '---',
      'coherence:',
      '  node_id: "req:refresh-validate"',
      '---',
      '',
      '# Behavioral',
      '',
    ].join('\n'));

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      rebuildFromFrontmatter('refresh-validate-test');

      fs.writeFileSync(path.join(specsDir, 'behavioral-spec.md'), [
        '---',
        'coherence:',
        '  node_id: INVALID_NO_PREFIX',
        '---',
        '',
        '# Broken Behavioral',
        '',
      ].join('\n'));

      const staleResult = validateCoherence(loadCoherenceWithStatus('refresh-validate-test').ceg);
      const freshResult = refreshAndValidateCoherence('refresh-validate-test');

      assert(staleResult.ok === true, 'stale coherence.json still looks valid before refresh');
      assert(freshResult.active === true, 'refresh validation detects active coherence metadata');
      assert(freshResult.rebuilt === false, 'frontmatter error prevents rebuild');
      assert(freshResult.validation.ok === false, 'refresh validation fails on current invalid frontmatter');
      assert(
        freshResult.validation.reason.includes('invalid node_id'),
        'refresh validation reports the current frontmatter error',
      );
    } finally {
      process.chdir(origCwd);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Bug 6: rebuildFromFrontmatter — recovers from corrupted coherence.json using frontmatter
{
  section('rebuildFromFrontmatter — recovers from corrupted coherence.json via fresh rebuild');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcsdd-coherence-recover-'));
  try {
    const featureDir = path.join(tmpDir, '.vcsdd', 'features', 'recover-corrupt-test');
    const specsDir = path.join(featureDir, 'specs');
    const coherencePath = path.join(featureDir, 'coherence.json');
    fs.mkdirSync(specsDir, { recursive: true });

    fs.writeFileSync(path.join(specsDir, 'behavioral-spec.md'), [
      '---',
      'coherence:',
      '  node_id: "req:recoverable"',
      '---',
      '',
      '# Recoverable',
      '',
    ].join('\n'));
    fs.writeFileSync(coherencePath, '{not valid json!!!');

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const result = refreshAndValidateCoherence('recover-corrupt-test');
      const rebuiltCeg = loadCoherenceWithStatus('recover-corrupt-test').ceg;

      assert(result.active === true, 'corrupted graph feature remains active');
      assert(result.rebuilt === true, 'refresh validation rebuilds corrupted graph');
      assert(result.recoveredFromCorruption === true, 'corruption recovery is reported');
      assert(result.validation.ok === true, 'rebuilt graph validates cleanly');
      assert(fs.existsSync(coherencePath + '.bak'), 'corrupted graph backup is preserved');
      assert(rebuiltCeg && rebuiltCeg.nodes['req:recoverable'], 'fresh graph is rebuilt from frontmatter');
    } finally {
      process.chdir(origCwd);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Bug 7: rebuildFromFrontmatter — throws on invalid node_id (no silent skip)
{
  section('rebuildFromFrontmatter — throws on invalid node_id');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcsdd-coherence-invalid-nodeid-'));
  try {
    const featureDir = path.join(tmpDir, '.vcsdd', 'features', 'invalid-nodeid-test');
    const specsDir = path.join(featureDir, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });

    fs.writeFileSync(path.join(specsDir, 'behavioral-spec.md'), [
      '---',
      'coherence:',
      '  node_id: "INVALID_NO_PREFIX"',
      '---',
      '',
      '# Broken node id',
      '',
    ].join('\n'));

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      let threw = false;
      let thrownMessage = '';
      try {
        rebuildFromFrontmatter('invalid-nodeid-test');
      } catch (err) {
        threw = true;
        thrownMessage = err.message;
      }
      assert(threw, 'rebuildFromFrontmatter throws when node_id is invalid');
      assert(thrownMessage.includes('invalid node_id'), 'error message mentions invalid node_id');
      assert(thrownMessage.includes('behavioral-spec.md'), 'error message mentions the broken file path');
    } finally {
      process.chdir(origCwd);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Bug 8: rebuildFromFrontmatter — throws on malformed coherence frontmatter
{
  section('rebuildFromFrontmatter — throws on malformed coherence frontmatter');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcsdd-coherence-invalid-frontmatter-'));
  try {
    const featureDir = path.join(tmpDir, '.vcsdd', 'features', 'invalid-frontmatter-test');
    const specsDir = path.join(featureDir, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });

    fs.writeFileSync(path.join(specsDir, 'behavioral-spec.md'), [
      '---',
      'coherence:',
      '  node_id "req:broken"',
      '---',
      '',
      '# Broken frontmatter',
      '',
    ].join('\n'));

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      let threw = false;
      let thrownMessage = '';
      try {
        rebuildFromFrontmatter('invalid-frontmatter-test');
      } catch (err) {
        threw = true;
        thrownMessage = err.message;
      }
      assert(threw, 'rebuildFromFrontmatter throws when coherence frontmatter is malformed');
      assert(thrownMessage.includes('invalid frontmatter'), 'error message mentions invalid frontmatter');
      assert(thrownMessage.includes('behavioral-spec.md'), 'error message mentions the broken file path');
    } finally {
      process.chdir(origCwd);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Bug 9: detectChangedNodes — auto-detect changed spec/file nodes from git diff
{
  section('detectChangedNodes — auto-detects start nodes from git diff');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcsdd-coherence-git-diff-'));
  try {
    runGit(['init'], tmpDir);
    runGit(['config', 'user.name', 'VCSDD Test'], tmpDir);
    runGit(['config', 'user.email', 'test@example.com'], tmpDir);

    const featureDir = path.join(tmpDir, '.vcsdd', 'features', 'git-impact-test');
    const specsDir = path.join(featureDir, 'specs');
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });

    const systemSpecPath = path.join(specsDir, 'system-design.md');
    const apiSpecPath = path.join(specsDir, 'api-design.md');
    const sourceFilePath = path.join(srcDir, 'auth.ts');

    fs.writeFileSync(systemSpecPath, [
      '---',
      'codd:',
      '  node_id: "design:system-design"',
      '  modules:',
      '    - "auth"',
      '  source_files:',
      '    - "src/auth.ts"',
      '---',
      '',
      '# System Design',
      '',
    ].join('\n'));
    fs.writeFileSync(apiSpecPath, [
      '---',
      'coherence:',
      '  node_id: "design:api-design"',
      '  depends_on:',
      '    - id: "design:system-design"',
      '---',
      '',
      '# API Design',
      '',
    ].join('\n'));
    fs.writeFileSync(sourceFilePath, 'export const auth = true;\n');

    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      rebuildFromFrontmatter('git-impact-test');

      runGit(['add', '.'], tmpDir);
      runGit(['commit', '-m', 'initial'], tmpDir);

      fs.writeFileSync(systemSpecPath, [
        '---',
        'codd:',
        '  node_id: "design:system-design"',
        '  modules:',
        '    - "auth"',
        '  source_files:',
        '    - "src/auth.ts"',
        '---',
        '',
        '# System Design',
        '',
        'Updated requirement.',
        '',
      ].join('\n'));
      fs.writeFileSync(sourceFilePath, 'export const auth = false;\n');

      const changed = getChangedFilesFromGit(tmpDir, 'HEAD');
      assert(changed.ok === true, 'git diff HEAD succeeds');
      assertEqual(
        changed.changedFiles.sort(),
        [
          '.vcsdd/features/git-impact-test/specs/system-design.md',
          'src/auth.ts',
        ].sort(),
        'git diff HEAD returns changed spec and source files'
      );

      const ceg = loadCoherenceWithStatus('git-impact-test').ceg;
      const resolved = resolveChangedNodes(ceg, tmpDir, changed.changedFiles);
      assert(resolved.some(entry => entry.nodeId === 'design:system-design' && entry.resolution === 'frontmatter.node_id'),
        'changed spec resolves to its frontmatter node_id');
      assert(resolved.some(entry => entry.nodeId === 'file:src/auth.ts' && entry.resolution === 'file-node'),
        'changed source file resolves to file:path node');

      const detected = detectChangedNodes('git-impact-test');
      assert(detected.ok === true, 'detectChangedNodes succeeds');
      assertEqual(detected.diffTarget, 'HEAD', 'default diff target is HEAD');
      assertEqual(detected.changedFiles.sort(), changed.changedFiles.sort(), 'detectChangedNodes returns git diff file list');
      assert(detected.startNodes.some(entry => entry.nodeId === 'design:system-design'),
        'detectChangedNodes includes changed spec node');
      assert(detected.startNodes.some(entry => entry.nodeId === 'file:src/auth.ts'),
        'detectChangedNodes includes changed file node');
    } finally {
      process.chdir(origCwd);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Results
// ══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
