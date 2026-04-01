# /vcsdd-coherence-scan — Coherence Graph Scan

## What

Rebuild the Conditioned Evidence Graph (CEG) from `coherence:` or `codd:`
frontmatter
declared in the feature's spec files. The CEG tracks dependency
relationships between spec documents and declared implementation modules so
that change-impact analysis is always current.

## When to use

- After writing or editing any spec file that contains a `coherence:` or `codd:` block
- Before running `/vcsdd-coherence-impact` to ensure the graph is up to date
- Whenever you want to initialise coherence tracking for a new feature

## Prerequisites

- An active VCSDD feature pipeline (`.vcsdd/features/<name>/` exists)
- At least one spec file with a `coherence:` or `codd:` frontmatter block

## Frontmatter format

Add a `coherence:` block to the top of any Markdown spec file.
For upstream CoDD compatibility, `codd:` is also accepted. Prefer `coherence:`
in VCSDD-authored docs, but do not rewrite imported CoDD docs solely for key naming.

```yaml
---
coherence:
  node_id: "design:api-design"     # Required — unique ID with prefix
  type: design                      # Optional — inferred from prefix if omitted
  name: "API Design"                # Optional — display name
  depends_on:
    - id: "design:system-design"
      relation: derives_from        # Optional, default: depends_on
    - id: "req:auth-requirements"
      relation: specifies
  depended_by:
    - id: "design:ui-design"        # Nodes that depend on this doc
  modules:
    - "auth"
    - "module:session"              # CoDD-style implementation module links
  conventions:
    - targets:
        - "module:auth"             # Node IDs that must be reviewed when this doc changes
      reason: "Auth policy applies to all modules"
  data_dependencies:
    - table: "users"
      column: "tenant_id"
      affects:
        - "module:billing"          # Nodes impacted when this column changes
      condition: "multi-tenant isolation"
  source_files:
    - "src/api/routes.ts"           # File-path traceability metadata
---
```

`modules:` participates in impact propagation by creating concrete
`module:*` nodes. `source_files:` records file paths for reference but does
not, by itself, drive forward BFS propagation.

Allowed `node_id` prefixes:
`req:`, `design:`, `db_table:`, `db_column:`, `module:`, `file:`, `test:`,
`config:`, `endpoint:`, `infra:`, `governance:`, `doc:`, `db:`, `detail:`, `plan:`, `ops:`

## Steps

1. Identify the active feature name from `.vcsdd/active-feature.txt`
2. Run the CEG rebuild:

```js
const { rebuildFromFrontmatter, summarize } = require('./scripts/lib/vcsdd-coherence');
const featureName = /* active feature name */;
const ceg = rebuildFromFrontmatter(featureName);
const summary = summarize(ceg);
```

3. Report the result:

```
Coherence scan complete
  Nodes  : <nodeCount>
  Edges  : <edgeCount>
  Green  : <green>   (≥90% confidence, ≥2 evidence)
  Amber  : <amber>   (≥50% confidence)
  Gray   : <gray>    (<50% confidence)
  Cycles : <hasCycles ? "⚠ CYCLES DETECTED" : "none">
```

4. If cycles are detected, list them and advise the user to resolve the
   circular dependencies before continuing.

## Output

- `.vcsdd/features/<name>/coherence.json` is created or updated
- A summary is printed to the conversation

## Troubleshooting

| Symptom | Resolution |
|---------|------------|
| "No spec files with coherence: frontmatter found" | Add `coherence:` blocks to spec files |
| Cycle detected | Check `depends_on` / `depended_by` for circular references; resolve before proceeding |
| Unknown node_id prefix | Use one of the allowed prefixes listed above |
