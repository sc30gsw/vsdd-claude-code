---
name: vcsdd-feedback
description: Run Phase 4 (feedback routing) after an adversarial review FAIL. Routes adversary findings to the earliest affected phase, checks iteration limits, and escalates to human if limits are exceeded.
---

## What
Runs the feedback integration loop (Phase 4). Reads adversary findings from the latest verdict, routes each to the appropriate phase, explicitly enters Phase `4`, and then transitions the pipeline back for rework.

## When
Run after `/vcsdd-adversary` returns a FAIL verdict. Normally starts from phase `3`; if routing was already started, phase `4` is also valid.

## How

1. **Read latest verdict**: `reviews/sprint-N/output/verdict.json`
2. **Read all findings**: `reviews/sprint-N/output/findings/FIND-NNN.json`
3. **Check iteration limits**: use mode-aware limits before re-entering adversarial review
   - `strict`: phase `3` max `5`
   - `lean`: phase `3` max `3`
4. **Group findings by routeToPhase**:
   ```
   1a: [FIND-001, FIND-003]  <- spec ambiguity
   2a: [FIND-002]            <- missing test
   2b: [FIND-004, FIND-005]  <- implementation bug
   ```
5. **Route to EARLIEST affected phase** (route to 1a before 1b before 2a before 2b before 2c before 5)
   - runtime validates the current sprint's persisted findings and rejects any target that skips an earlier routed phase
6. **Create adversary-finding beads** for each finding
   - completion will later fail if any persisted finding lacks a matching `adversary-finding` bead
7. **Advance through explicit feedback routing**:
   - if current phase is `3`, transition `3 -> 4`
   - from phase `4`, transition to the selected target phase
   - use `routeFeedback(featureName, targetPhase, reason)` from `scripts/lib/vcsdd-state.js` instead of hand-rolling `transitionPhase()` calls
   - `routeFeedback()` only proceeds when the latest sprint verdict is `FAIL`
8. **Display routing summary**: "Routing 5 findings. 2 -> Phase 1a, 3 -> Phase 2b"
9. **Next action**: prompt user to run appropriate command for the target phase

## Feedback Routing Table

`dimension` controls grading. `category` controls routing. The `routeToPhase` field on each finding is authoritative.

| Category | Typical Severity | Route To |
|----------|------------------|----------|
| `spec_ambiguity` | any | Phase 1a |
| `spec_gap` | any | Phase 1a |
| `verification_tool_mismatch` | any | Phase 1b |
| `requirement_mismatch` | any | Phase 2b |
| `missing_edge_case` | critical | Phase 1a |
| `missing_edge_case` | high/medium/low | Phase 2a |
| `test_coverage` | any | Phase 2a |
| `test_quality` | any | Phase 2a |
| `implementation_bug` | any | Phase 2b |
| `error_handling` | any | Phase 2b |
| `security_surface` | any | Phase 2b |
| `code_structure` | any | Phase 2c |
| `naming` | any | Phase 2c |
| `duplication` | any | Phase 2c |
| `proof_gap` | any | Phase 5 |
| `invariant_violation` | any | Phase 5 |
| `purity_boundary` | any | Phase 1b by default; Phase 2c or Phase 5 only when the architecture itself remains valid |

## Examples

```bash
/vcsdd-feedback
/vcsdd-feedback --show-routing    # display full routing table before applying
```
