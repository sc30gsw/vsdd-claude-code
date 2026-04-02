---
name: vcsdd-spec-review
description: Run Phase 1c (spec review gate) for the active VCSDD feature. Spawns a fresh vcsdd-adversary instance to review the behavioral spec and verification architecture. Records PASS/FAIL gate verdict.
---

## What
Runs the spec review gate (Phase 1c). Spawns a fresh vcsdd-adversary agent to review the behavioral specification and verification architecture for completeness, correctness, and verification readiness. Records the gate verdict.

## When
Run after `/vcsdd-spec` completes Phase 1a and 1b. Requires active feature at phase `1b`.

## How

1. **Write spec review manifest** to `reviews/spec/iteration-N/input/manifest.json`:
   ```json
   {
     "reviewType": "spec",
     "artifactsToReview": ["specs/behavioral-spec.md", "specs/verification-architecture.md"],
     "reviewDimensions": ["spec_fidelity", "verification_readiness"]
   }
   ```
2. **Spawn fresh vcsdd-adversary agent** (new context, no Builder history)
3. **Adversary reads and reviews** spec files only (no source code yet)
4. **Collect verdict** from `reviews/spec/iteration-N/output/verdict.json`
5. **Record adversary verdict**: `recordGate(feature, '1c', verdict, 'adversary')`
6. **If PASS in lean mode**: transition to Phase 2a when the user is ready
7. **If PASS in strict mode**: require explicit user confirmation, then record human approval:
   `recordGate(feature, '1c', 'PASS', 'human', { approvedBasedOn: 'adversary' })`
8. **If FAIL**: display findings, check iteration limit (max 3), prompt for revision

## Examples

```bash
/vcsdd-spec-review
/vcsdd-spec-review --auto-approve    # strict mode: record the human approval immediately after a PASS
```
