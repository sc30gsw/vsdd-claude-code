---
description: Run Phase 1c (spec review gate) for the active VSDD feature. Spawns a fresh vsdd-adversary instance to review the behavioral spec and verification architecture. Records PASS/FAIL gate verdict.
---

## What
Runs the spec review gate (Phase 1c). Spawns a fresh vsdd-adversary agent to review the behavioral specification for completeness, correctness, and testability. Records the gate verdict.

## When
Run after `/vsdd-spec` completes Phase 1a and 1b. Requires active feature at phase `1b` (or `1a` in lean mode).

## How

1. **Write review manifest** to `reviews/sprint-1/input/manifest.json`:
   ```json
   {
     "reviewType": "spec",
     "artifactsToReview": ["specs/behavioral-spec.md", "specs/verification-architecture.md"],
     "reviewDimensions": ["spec_fidelity", "verification_readiness"]
   }
   ```
2. **Spawn fresh vsdd-adversary agent** (new context, no Builder history)
3. **Adversary reads and reviews** spec files only (no source code yet)
4. **Collect verdict** from `reviews/sprint-1/output/verdict.json`
5. **Record gate**: `recordGate(feature, '1c', verdict, 'adversary')`
6. **If PASS**: transition to Phase 2a, notify user
7. **If FAIL**: display findings, check iteration limit (max 3), prompt for revision
8. **Human approval**: in strict mode, require explicit user confirmation before proceeding to 2a

## Examples

```bash
/vsdd-spec-review
/vsdd-spec-review --auto-approve    # lean mode: skip human confirmation on PASS
```
