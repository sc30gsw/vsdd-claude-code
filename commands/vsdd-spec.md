---
description: Run Phase 1a (behavioral specification) and Phase 1b (verification architecture) for the active VSDD feature. Invokes vsdd-builder to write EARS-format requirements and purity boundary analysis.
---

## What
Runs the spec crystallization phases (1a and 1b) for the active feature. Phase 1a produces the behavioral specification using EARS format. Phase 1b produces the verification architecture with purity boundary map and proof obligations.

## When
Run immediately after `/vsdd-init`. Requires active feature at phase `init` or `1a`.

## How

1. **Check active feature**: read `.vsdd/active-feature.txt`
2. **Check current phase**: must be `init`, `1a`, or `1b`
3. **Invoke vsdd-builder agent** for Phase 1a:
   - Write `specs/behavioral-spec.md` with EARS requirements
   - Cover all functional requirements, edge cases, and non-functional constraints
   - Identify purity boundary candidates
4. **Transition to 1a**: `transitionPhase(feature, '1a')`
5. **In strict mode**: also run Phase 1b:
   - Write `specs/verification-architecture.md`
   - Define proof obligations (PROP-XXX) per requirement
   - Assign verification tiers (0-3)
   - Map purity boundary explicitly
6. **Transition to 1b**: `transitionPhase(feature, '1b')`
7. **Create traceability beads** for each REQ-XXX and PROP-XXX

## Lean Mode Behavior
Phase 1b is optional. In lean mode, skip verification architecture unless the feature has critical invariants. Transition directly to 1c (or 2a if gate is skipped).

## Examples

```bash
/vsdd-spec
/vsdd-spec --skip-arch    # lean mode: skip phase 1b
```
