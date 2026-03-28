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

`dimension` controls grading. `category` controls routing. The `routeToPhase` field on each finding is authoritative.

| Category | Typical Severity | Route To |
|----------|------------------|----------|
| `spec_ambiguity` | any | Phase 1a |
| `spec_gap` | any | Phase 1a |
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
| `purity_boundary` | any | Phase 2c or Phase 5 |

## Examples

```bash
/vsdd-feedback
/vsdd-feedback --show-routing    # display full routing table before applying
```
