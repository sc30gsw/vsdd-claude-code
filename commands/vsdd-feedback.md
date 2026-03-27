---
description: Run Phase 4 (feedback routing) after an adversarial review FAIL. Routes adversary findings to the earliest affected phase, checks iteration limits, and escalates to human if limits are exceeded.
---

## What
Runs the feedback integration loop (Phase 4). Reads adversary findings from the latest verdict, routes each to the appropriate phase, and transitions the pipeline back for rework.

## When
Run after `/vsdd-adversary` returns a FAIL verdict. Requires active feature at phase `3`.

## How

1. **Read latest verdict**: `reviews/sprint-N/output/verdict.json`
2. **Read all findings**: `reviews/sprint-N/output/findings/FIND-NNN.json`
3. **Check iteration limits**: if phase 3 has exceeded 5 iterations, write escalation and pause
4. **Group findings by routeToPhase**:
   ```
   1a: [FIND-001, FIND-003]  <- spec ambiguity
   2a: [FIND-002]            <- missing test
   2b: [FIND-004, FIND-005]  <- implementation bug
   ```
5. **Route to EARLIEST affected phase** (route to 1a before 2a before 2b before 2c before 5)
6. **Create adversary-finding beads** for each finding
7. **Transition pipeline** to target phase via `transitionPhase()`
8. **Display routing summary**: "Routing 5 findings. 2 -> Phase 1a, 3 -> Phase 2b"
9. **Next action**: prompt user to run appropriate command for the target phase

## Feedback Routing Table

| Dimension | Severity | Route To |
|-----------|---------|---------|
| spec_fidelity | critical | Phase 1a |
| spec_fidelity | high | Phase 2b |
| edge_case_coverage | critical | Phase 1a + 2a |
| edge_case_coverage | high | Phase 2a |
| implementation_correctness | any | Phase 2b |
| structural_integrity | any | Phase 2c |
| verification_readiness | any | Phase 5 |

## Examples

```bash
/vsdd-feedback
/vsdd-feedback --show-routing    # display full routing table before applying
```
