---
name: vcsdd-feedback-routing
description: Use this skill when routing adversary findings in Phase 4. Provides routing logic, iteration limit enforcement, and escalation protocols.
origin: VCSDD
---

# VCSDD Feedback Routing

## When to Activate
- Phase 4 (feedback integration loop)
- Parsing adversary verdict.json
- Deciding which phase to route findings to

## Routing Table

| Finding Category | Severity | Route To |
|------------------|----------|----------|
| spec_ambiguity | any | Phase 1a |
| spec_gap | any | Phase 1a |
| requirement_mismatch | any | Phase 2b |
| missing_edge_case | critical | Phase 1a |
| missing_edge_case | high/medium/low | Phase 2a |
| test_coverage | any | Phase 2a |
| test_quality | any | Phase 2a |
| implementation_bug | any | Phase 2b |
| error_handling | any | Phase 2b |
| security_surface | any | Phase 2b |
| code_structure | any | Phase 2c |
| naming | any | Phase 2c |
| duplication | any | Phase 2c |
| proof_gap | any | Phase 5 |
| invariant_violation | any | Phase 5 |
| purity_boundary | any | Phase 1b by default; Phase 2c or 5 only when the architecture still stands |

**Always route to the EARLIEST affected phase.**

## Iteration Limit Enforcement

| Phase | Max Iterations | On Exceed |
|-------|---------------|-----------|
| 1c | 3 | Write escalation, pause for human |
| 3 (strict) | 5 | Write escalation, pause for human |
| 3 (lean) | 3 | Write escalation, pause for human |
| 6 | 2 | Write escalation, pause for human |

## Escalation Protocol

When iteration limit exceeded:
1. Write to `.vcsdd/features/<name>/escalations/escalation-<timestamp>.md`
2. Include: phase, iteration count, limit, all open findings
3. Surface to human: "Human review required. N findings remain after M iterations."
4. Pause pipeline - do not auto-advance

## Feedback Integration Steps

1. Read `reviews/sprint-N/output/verdict.json`
2. Read all `reviews/sprint-N/output/findings/FIND-NNN.json`
3. Group findings by `routeToPhase`
4. Route to earliest affected phase (e.g., if 1a and 2b both affected, route to 1a first)
5. Update finding beads to status "open" with resolution.status "open"
6. Transition pipeline via explicit Phase 4 routing:
   - if current phase is `3`, enter `4` first
   - from `4`, move to the target phase
   - prefer `routeFeedback(featureName, targetPhase, reason)` over hand-written `transitionPhase()` chains
