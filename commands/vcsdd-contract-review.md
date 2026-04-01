---
description: Run the strict-mode sprint contract review after Phase 2c. Spawns a fresh vcsdd-adversary instance to review `contracts/sprint-N.md` and writes a PASS/FAIL verdict under `reviews/contracts/sprint-N/output/`.
---

## What
Runs the sprint contract review gate. The adversary reviews the current sprint contract, the authoritative specs, and the current test/source artifact set to verify that the contract criteria are concrete, binary-evaluable, and aligned with what Phase 3 will judge.

## When
Run after `/vcsdd-impl` completes Phase 2c and after the builder updates `contracts/sprint-N.md`. Requires the active feature to still be at phase `2c`. Required in `strict` mode before `/vcsdd-adversary`. Optional in `lean` mode when a sprint contract is still being used.

## How

1. **Resolve sprint number** from `state.json.sprintCount`
2. **Validate contract exists** at `contracts/sprint-N.md`
   - must parse against `vcsdd-contract.schema.json`
   - should normally be in `draft` or `under-review` while negotiating
   - must contain at least one `CRIT-XXX`
3. **Write review manifest** to `reviews/contracts/sprint-N/input/manifest.json`:
   - compute `contractDigest` from the reviewed contract snapshot with line endings normalized and the `status:` frontmatter line ignored
   ```json
   {
     "reviewType": "contract",
     "featureName": "...",
     "sprintNumber": 1,
      "contractPath": "contracts/sprint-1.md",
      "contractDigest": "<sha256-of-reviewed-contract-with-status-normalized>",
      "artifactsToReview": {
        "spec": ["specs/behavioral-spec.md", "specs/verification-architecture.md"],
        "tests": ["tests/..."],
        "source": ["src/..."]
      },
     "reviewDimensions": ["spec_fidelity", "edge_case_coverage", "implementation_correctness", "structural_integrity", "verification_readiness"]
   }
   ```
4. **Create output directories**: `reviews/contracts/sprint-N/output/findings/`
5. **Spawn FRESH vcsdd-adversary agent** with zero Builder context
6. **Collect outputs** after adversary completes:
   - `reviews/contracts/sprint-N/output/verdict.json`
   - `reviews/contracts/sprint-N/output/findings/FIND-NNN.json`
   - contract-review verdicts must set:
     - `reviewContext.reviewType = "contract"`
     - `reviewContext.contractPath = "contracts/sprint-N.md"`
     - `reviewContext.contractDigest = manifest.contractDigest`
     - `iteration = negotiationRound + 1`
7. **Interpret verdict**:
   - `PASS`: the human may update `contracts/sprint-N.md` to `status: approved`
     - after PASS, only the `status` field may change without rerunning review
     - any substantive contract edit changes the digest and requires a new contract review
   - `FAIL`: revise the contract, increment `negotiationRound`, and rerun
8. **Negotiation limit**: maximum 2 rounds before human escalation

## Gate Semantics

Strict-mode Phase 3 requires both:
- `contracts/sprint-N.md` with `status: approved`
- `reviews/contracts/sprint-N/output/verdict.json` with:
  - `overallVerdict: "PASS"`
  - matching `reviewContext.contractPath`
  - matching `reviewContext.contractDigest`
  - `iteration = negotiationRound + 1`

This prevents self-approved or post-review-edited sprint contracts from bypassing the adversarial gate.

## Examples

```bash
/vcsdd-contract-review
/vcsdd-contract-review --sprint 2
```
