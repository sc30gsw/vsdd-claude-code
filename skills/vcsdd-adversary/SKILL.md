---
name: vcsdd-adversary
description: "Run Phase 3 (adversarial review) for the active VCSDD feature. Spawns a fresh adversary agent with zero Builder context to review implementation against spec across 5 dimensions with binary PASS/FAIL verdicts. Use when requesting adversarial review, validating implementation quality, or running Phase 3."
---

## How

1. **Resolve sprint number** from `state.json.sprintCount`
2. **In strict mode, validate contract gate**:
   - `contracts/sprint-N.md` must exist with `status: approved` and at least one `CRIT-XXX`
   - `reviews/contracts/sprint-N/output/verdict.json` must have `overallVerdict: "PASS"`
   - `reviewContext.contractDigest` must still match the approved contract snapshot
3. **Write review manifest** to `reviews/sprint-N/input/manifest.json`:
   ```json
   {
     "reviewType": "implementation",
     "featureName": "...",
     "sprintNumber": 1,
     "artifactsToReview": {
       "spec": ["specs/behavioral-spec.md", "specs/verification-architecture.md"],
       "tests": ["tests/..."],
       "source": ["src/..."]
     },
     "reviewDimensions": ["spec_fidelity", "edge_case_coverage", "implementation_correctness", "structural_integrity", "verification_readiness"]
   }
   ```
4. **Create output directories**: `reviews/sprint-N/output/findings/`
5. **Spawn FRESH vcsdd-adversary agent** — must be a new Agent instance with zero Builder context. The adversary reads ONLY from disk (review manifest + source files). Do NOT pass conversation history or Builder reasoning.
6. **Collect outputs**:
   - `reviews/sprint-N/output/verdict.json`
   - `reviews/sprint-N/output/findings/FIND-NNN.json` (one per finding)
7. **Record gate**:
   ```javascript
   const { recordGate } = require(path.join(pluginRoot, 'scripts/lib/vcsdd-state.js'));
   recordGate(featureName, '3', overallVerdict, 'adversary');
   ```
8. **If PASS**: transition to Phase 5, display summary
9. **If FAIL**: display findings grouped by dimension, proceed to `/vcsdd-feedback`

## Examples

```bash
/vcsdd-adversary
/vcsdd-adversary --sprint 2
```
