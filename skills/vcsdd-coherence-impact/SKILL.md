# /vcsdd-coherence-impact — Coherence Impact Analysis

## What

Given a set of changed or affected spec nodes, perform BFS forward-impact
propagation through the CEG to identify all downstream documents that may
need updating.  Results are classified into Green / Amber / Gray bands.

## When to use

- When a spec document is modified and you need to know what else is affected
- After Phase 4 (feedback routing) routes a finding back to Phase 1a/1b —
  to identify all other specs impacted by the required spec change
- Before starting a new sprint to assess change scope

## Prerequisites

- An active VCSDD feature pipeline
- `coherence.json` exists (run `/vcsdd-coherence-scan` first)

## Steps

1. Ask the user which node(s) changed, OR infer from the current Phase 4
   feedback finding (use `routeToPhase` + the affected spec node_id)

2. Load the CEG and run impact analysis:

```js
const { loadCoherence, propagateImpact, generateImpactReport } = require('./scripts/lib/vcsdd-coherence');
const featureName = /* active feature */;
const ceg = loadCoherence(featureName);
if (!ceg) { /* coherence not active, skip */ }
const impacts = propagateImpact(ceg, [changedNodeId], 10, 0);
const report = generateImpactReport(impacts, ceg);
```

3. Present the Markdown report to the user.

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
