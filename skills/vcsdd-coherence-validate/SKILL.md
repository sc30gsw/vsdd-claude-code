# /vcsdd-coherence-validate — Coherence Graph Validation

## What

Validate the CEG for structural integrity:
1. **Reference integrity** — all edge source/target IDs reference known nodes
2. **Cycle detection** — no circular dependencies in the dependency graph

This is run automatically as part of the `GATE_PREREQUISITES['2a']` check
when any spec frontmatter declares coherence metadata, or when
`coherence.json` is already present. You can also invoke it manually at any time.

## When to use

- After `/vcsdd-coherence-scan` to confirm graph integrity
- When the status command reports coherence validation errors
- Before transitioning to Phase 2a to pre-empt gate failures

## Steps

1. Refresh the CEG from current frontmatter, then run validation:

```js
const { refreshAndValidateCoherence } = require('./scripts/lib/vcsdd-coherence');
const featureName = /* active feature */;
const result = refreshAndValidateCoherence(featureName);
if (!result.active) {
  // Coherence not active — nothing to validate
  return;
}
const summary = result.summary;
```

2. Report results:

**If `result.validation.ok === true`:**
```
✅ Coherence graph is valid
   Nodes : <nodeCount>   Edges : <edgeCount>
   Green : <green>   Amber : <amber>   Gray : <gray>
```

**If `result.recoveredFromCorruption === true`:**
```
ℹ coherence.json was corrupted, so VCSDD saved coherence.json.bak and rebuilt the graph from current frontmatter before validating.
```

**If `result.validation.ok === false` (cycles detected):**
```
❌ Coherence validation failed: Circular dependency detected
   Cycle: design:A -> design:B -> design:C -> design:A

   To resolve:
   1. Review the depends_on / depended_by declarations in the affected specs
   2. Break the cycle by removing one of the edges or restructuring the dependency
   3. Re-run /vcsdd-coherence-scan then /vcsdd-coherence-validate
```

**If `result.validation.ok === false` (dangling references / placeholder nodes / invalid frontmatter):**
```
❌ Coherence validation failed: Reference integrity errors
   - Edge 3: unknown target node "design:missing-doc"
     → Add the missing node or fix the node_id reference in the spec frontmatter
```

## Exit criteria

- `result.validation.ok === true` → proceed to Phase 2a
- Cycles detected → must be resolved before the Phase 2a gate will pass
- Dangling references / placeholder nodes / invalid frontmatter → must be resolved before the Phase 2a gate will pass
