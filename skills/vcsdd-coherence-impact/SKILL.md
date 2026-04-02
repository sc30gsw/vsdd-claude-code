# /vcsdd-coherence-impact — Coherence Impact Analysis

## What

Given a set of changed or affected spec nodes, perform BFS forward-impact
propagation through the CEG to identify all downstream documents that may
need updating. Also surface any CoDD `conventions:` / `must_review` alerts
attached to the changed node or its immediate parents. Results are classified
into Green / Amber / Gray bands.

If no node is provided, auto-detect changed files from `git diff --name-only HEAD`
and resolve them to start nodes using CoDD-compatible rules:
- changed Markdown spec with `coherence:` or `codd:` frontmatter -> `node_id`
- changed source/config file with a tracked `file:<path>` node -> `file:<path>`
- changed file matching a node's stored `path` -> that node

## When to use

- When a spec document is modified and you need to know what else is affected
- After Phase 4 (feedback routing) routes a finding back to Phase 1a/1b —
  to identify all other specs impacted by the required spec change
- Before starting a new sprint to assess change scope

## Prerequisites

- An active VCSDD feature pipeline
- `coherence.json` exists (run `/vcsdd-coherence-scan` first)

## Steps

1. Determine start nodes in this order:
   - If the user passed explicit `node_id` arguments, use them.
   - Else if the command included `--diff <target>`, auto-detect from that git diff target.
   - Else auto-detect from uncommitted changes (`HEAD`).
   - If Phase 4 feedback already names a `node_id`, you may use that directly.

2. Load the CEG and resolve changed files when auto-detecting:

```js
const {
  loadCoherence,
  detectChangedNodes,
  propagateImpact,
  collectConventionAlerts,
  generateImpactReport,
} = require('./scripts/lib/vcsdd-coherence');
const featureName = /* active feature */;
const ceg = loadCoherence(featureName);
if (!ceg) { /* coherence not active, skip */ }
const detected = detectChangedNodes(featureName, { diffTarget: 'HEAD' });
const startNodes = detected.startNodes.map(entry => entry.nodeId);
const impacts = propagateImpact(ceg, startNodes, 10, 0);
const conventionAlerts = collectConventionAlerts(ceg, startNodes);
const report = generateImpactReport(impacts, ceg, undefined, { conventionAlerts });
```

3. Present the Markdown report to the user, including:
   - which files changed
   - which graph start nodes they resolved to
   - the Green / Amber / Gray impact bands

4. If auto-detection returns no start nodes:
   - say that no changed files mapped into the CEG
   - advise the user to pass explicit `node_id` values or add `coherence:` / `codd:` / `source_files:` metadata

## Band interpretation and required actions

| Band | Confidence | Action |
|------|-----------|--------|
| 🟢 Green | ≥90%, ≥2 evidence | Auto-propagate changes to these specs |
| 🟡 Amber | ≥50% | Require human review before updating |
| ⚪ Gray  | <50%  | Informational — note but do not automatically update |

## Output format

```markdown
## Coherence Impact Report

### 🟢 Green — Auto-propagate safe
- **System Design** (`design:system-design`) — depth 1, confidence 90%
- **Database Design** (`design:db-design`) — depth 2, confidence 81%

### 🟡 Amber — Human review required
- **Test Strategy** (`design:test-strategy`) — depth 2, confidence 72%

### ⚪ Gray — Informational only
- **Implementation Plan** (`design:impl-plan`) — depth 3, confidence 34%
```

## Integration with Phase 4

When `/vcsdd-feedback` routes a finding to Phase 1a, automatically run this
skill and append the impact report to the history event.  This enriches the
feedback context with dependency-aware information.
