---
description: Run the strict-mode sprint contract review after Phase 2c. Spawns a fresh vsdd-adversary instance to review `contracts/sprint-N.md` and writes a PASS/FAIL verdict under `reviews/contracts/sprint-N/output/`.
---

## What
Runs the sprint contract review gate. The adversary reviews the current sprint contract, the authoritative specs, and the current test/source artifact set to verify that the contract criteria are concrete, binary-evaluable, and aligned with what Phase 3 will judge.

## When
Run after `/vsdd-impl` completes Phase 2c and after the builder updates `contracts/sprint-N.md`. Requires the active feature to still be at phase `2c`. Required in `strict` mode before `/vsdd-adversary`. Optional in `lean` mode when a sprint contract is still being used.

## How

1. **Resolve sprint number** from `state.json.sprintCount`
2. **Validate contract exists** at `contracts/sprint-N.md`
   - must parse against `vsdd-contract.schema.json`
   - should normally be in `draft` or `under-review` while negotiating
   - must contain at least one `CRIT-XXX`
3. **Write review manifest** to `reviews/contracts/sprint-N/input/manifest.json`:
   ```json
   {
     "reviewType": "contract",
     "featureName": "...",
     "sprintNumber": 1,
     "contractPath": "contracts/sprint-1.md",
     "artifactsToReview": {
       "spec": ["specs/behavioral-spec.md", "specs/verification-architecture.md"],
       "tests": ["tests/..."],
       "source": ["src/..."]
     },
     "reviewDimensions": ["spec_fidelity", "edge_case_coverage", "implementation_correctness", "structural_integrity", "verification_readiness"]
   }
   ```
4. **Create output directories**: `reviews/contracts/sprint-N/output/findings/`
5. **Spawn FRESH vsdd-adversary agent** with zero Builder context
6. **Collect outputs** after adversary completes:
   - `reviews/contracts/sprint-N/output/verdict.json`
   - `reviews/contracts/sprint-N/output/findings/FIND-NNN.json`
7. **Interpret verdict**:
   - `PASS`: the human updates `contracts/sprint-N.md` to `status: approved`
   - `FAIL`: revise the contract, increment `negotiationRound`, and rerun
8. **Negotiation limit**: maximum 2 rounds before human escalation

## Gate Semantics

Strict-mode Phase 3 requires both:
- `contracts/sprint-N.md` with `status: approved`
- `reviews/contracts/sprint-N/output/verdict.json` with `overallVerdict: "PASS"`

This prevents self-approved sprint contracts from bypassing the adversarial gate.

## Examples

```bash
/vsdd-contract-review
/vsdd-contract-review --sprint 2
```
