---
name: vsdd-feedback-routing
description: Use this skill when routing adversary findings in Phase 4. Provides routing logic, iteration limit enforcement, and escalation protocols.
origin: VSDD
---

# VSDD Feedback Routing

## When to Activate
- Phase 4 (feedback integration loop)
- Parsing adversary verdict.json
- Deciding which phase to route findings to

## Routing Table

| Finding Dimension | Severity | Route To |
|-------------------|---------|---------|
| spec_fidelity | critical | Phase 1a (spec ambiguous) |
| spec_fidelity | high | Phase 2b (implementation wrong) |
| edge_case_coverage | critical | Phase 1a + Phase 2a |
| edge_case_coverage | high | Phase 2a |
| implementation_correctness | any | Phase 2b |
| structural_integrity | any | Phase 2c |
| verification_readiness | any | Phase 5 |

**Always route to the EARLIEST affected phase.**

## Iteration Limit Enforcement

| Phase | Max Iterations | On Exceed |
|-------|---------------|-----------|
| 1c | 3 | Write escalation, pause for human |
| 3 | 5 | Write escalation, pause for human |
| 6 | 2 | Write escalation, pause for human |

## Escalation Protocol

When iteration limit exceeded:
1. Write to `.vsdd/features/<name>/escalations/escalation-<timestamp>.md`
2. Include: phase, iteration count, limit, all open findings
3. Surface to human: "Human review required. N findings remain after M iterations."
4. Pause pipeline - do not auto-advance

## Feedback Integration Steps

1. Read `reviews/sprint-N/output/verdict.json`
2. Read all `reviews/sprint-N/output/findings/FIND-NNN.json`
3. Group findings by `routeToPhase`
4. Route to earliest affected phase (e.g., if 1a and 2b both affected, route to 1a first)
5. Update finding beads to status "open" with resolution.status "open"
6. Transition pipeline to target phase via `transitionPhase()`
