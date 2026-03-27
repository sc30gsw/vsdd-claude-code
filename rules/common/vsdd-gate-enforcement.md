# VSDD Gate Enforcement Rules

## Phase Ordering

The VSDD pipeline enforces strict phase ordering. No phase can be entered without completing its prerequisites.

## Gate Prerequisites

| Phase | Requires |
|-------|----------|
| 1b (Verification Architecture) | behavioral-spec.md exists in specs/ |
| 1c (Spec Review Gate) | verification-architecture.md exists in specs/ |
| 2a (Test Generation - Red) | Spec gate passed: adversary PASS on spec review |
| 2b (Implementation - Green) | Red phase evidence: new feature tests fail, regression baseline green |
| 2c (Refactor) | Green phase evidence: all tests (target + regression) pass |
| 3 (Adversarial Review) | Tests pass post-refactor |
| 5 (Formal Hardening) | Adversary verdict PASS on implementation |
| 6 (Convergence Check) | Verification report exists, all required proof obligations pass |

## Write Restrictions by Phase

Source code files (src/, lib/, main implementation) may NOT be written during:
- init, 1a, 1b, 1c (spec phases - no code yet)

Test files may NOT be written during:
- init, 1a, 1b (before spec gate)

Spec files may only be modified during:
- 1a, 1b, 1c (spec phases)
- 4 (feedback loop if routed to 1a)

## Iteration Limits (Safety Valve)

| Phase | Max Iterations | On Exceed |
|-------|---------------|-----------|
| 1c (Spec Review) | 3 | Escalate to human |
| 3 (Implementation Review) | 5 | Escalate to human |
| 6 (Convergence) | 2 | Escalate to human |

When an iteration limit is reached, an escalation record is written to escalations/ and the pipeline pauses for human intervention.

## Lean Mode Relaxations

In lean mode, the following gates are relaxed:
- Phase 1b: Optional (can skip verification architecture)
- Phase 1c: Single round or auto-SKIP
- Phase 2c: Merged into 2b (refactor is part of implementation)
- Phase 5: Skipped unless proof obligations exist
- Gate enforcement hooks use standard profile (not strict)
