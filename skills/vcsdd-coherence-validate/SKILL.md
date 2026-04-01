# /vcsdd-coherence-validate — Coherence Graph Validation

## What

Validate the CEG for structural integrity:
1. **Reference integrity** — all edge source/target IDs reference known nodes
2. **Cycle detection** — no circular dependencies in the dependency graph

This is run automatically as part of the `GATE_PREREQUISITES['2a']` check
when `coherence.json` is present.  You can also invoke it manually at any time.

## When to use

- After `/vcsdd-coherence-scan` to confirm graph integrity
- When the status command reports coherence warnings
- Before transitioning to Phase 2a to pre-empt gate failures

## Steps

1. Load the CEG and run validation:

```js
const { loadCoherence, validateCoherence, summarize } = require('./scripts/lib/vcsdd-coherence');
const featureName = /* active feature */;
const ceg = loadCoherence(featureName);
if (!ceg) {
  // Coherence not active — nothing to validate
  return;
}
const result = validateCoherence(ceg);
const summary = summarize(ceg);
```

2. Report results:

**If `result.ok === true`:**
```
✅ Coherence graph is valid
   Nodes : <nodeCount>   Edges : <edgeCount>
   Green : <green>   Amber : <amber>   Gray : <gray>
```

**If `result.ok === false` (cycles detected):**
```
❌ Coherence validation failed: Circular dependency detected
   Cycle: design:A -> design:B -> design:C -> design:A

   To resolve:
   1. Review the depends_on / depended_by declarations in the affected specs
   2. Break the cycle by removing one of the edges or restructuring the dependency
   3. Re-run /vcsdd-coherence-scan then /vcsdd-coherence-validate
```

**If warnings exist (dangling references):**
```
⚠ Warnings:
   - Edge 3: unknown target node "design:missing-doc"
     → Add the missing node or fix the node_id reference in the spec frontmatter
```

## Exit criteria

- `result.ok === true` with zero warnings → proceed to Phase 2a
- Cycles detected → must be resolved before Phase 2a gate will pass
- Warnings only → document them and proceed at your discretion
