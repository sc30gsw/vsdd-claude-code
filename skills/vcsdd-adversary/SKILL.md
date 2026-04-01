---
name: vcsdd-adversary
description: Run Phase 3 (adversarial review) for the active VCSDD feature. Spawns a fresh vcsdd-adversary agent with zero Builder context to review implementation against spec. Produces binary PASS/FAIL verdict per dimension.
---

## What
Runs the adversarial review (Phase 3). Spawns a fresh vcsdd-adversary agent (opus model, review-output-only, zero Builder context) to review the implementation against the spec across 5 dimensions.

## When
Run after `/vcsdd-impl` completes Phases 2b and 2c. Requires active feature at phase `2c`. In strict mode, `/vcsdd-contract-review` must already have produced a PASS verdict for the current sprint contract.

## How

1. **Resolve sprint number** from `state.json.sprintCount` (created when Phase 2a starts)
2. **In strict mode, validate contract gate** before review:
   - `contracts/sprint-N.md` must exist
   - frontmatter must include `status: approved`
   - the contract must define at least one `CRIT-XXX` criterion
   - `reviews/contracts/sprint-N/output/verdict.json` must exist and `overallVerdict` must be `PASS`
   - `reviewContext.contractPath` must reference `contracts/sprint-N.md`
   - `reviewContext.contractDigest` must still match the approved contract snapshot
   - `iteration` must equal `negotiationRound + 1`
3. **Write review manifest** to `reviews/sprint-N/input/manifest.json`:
   ```json
   {
     "reviewType": "implementation",
     "featureName": "...",
     "sprintNumber": N,
     "contractPath": "contracts/sprint-N.md",
     "artifactsToReview": {
       "spec": ["specs/behavioral-spec.md", "specs/verification-architecture.md"],
       "tests": ["tests/..."],
       "source": ["src/..."]
     },
     "reviewDimensions": ["spec_fidelity", "edge_case_coverage", "implementation_correctness", "structural_integrity", "verification_readiness"]
   }
   ```
4. **Create output directories**: `reviews/sprint-N/output/findings/`
5. **Spawn FRESH vcsdd-adversary agent**: this MUST be a new agent with no Builder context
6. **Collect outputs** after adversary completes:
   - `reviews/sprint-N/output/verdict.json`
   - `reviews/sprint-N/output/findings/FIND-NNN.json` (one per finding)
7. **Record gate**: `recordGate(feature, '3', overallVerdict, 'adversary')`
8. **If PASS**: transition to Phase 5 in all modes, display summary
9. **If FAIL**: display findings grouped by dimension/category, proceed to `/vcsdd-feedback`

## Fresh Context Requirement

The adversary MUST be spawned as a new Agent instance. Do NOT:
- Pass Builder conversation history
- Share the current conversation context
- Let the adversary see Builder's reasoning

The adversary reads ONLY from disk (review manifest + source files).

## Examples

```bash
/vcsdd-adversary
/vcsdd-adversary --sprint 2    # specify sprint number explicitly
```
