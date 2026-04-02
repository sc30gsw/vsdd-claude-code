# VCSDD Gate Enforcement Rules

## Phase Ordering

The VCSDD pipeline enforces strict phase ordering. No phase can be entered without completing its prerequisites.

## Gate Prerequisites

| Phase | Requires |
|-------|----------|
| 1b (Verification Architecture) | behavioral-spec.md exists in specs/ |
| 1c (Spec Review Gate) | verification-architecture.md exists in specs/ |
| 2a (Test Generation - Red) | Lean: adversary PASS on spec review. Strict: adversary PASS plus explicit human approval |
| 2b (Implementation - Green) | Red phase evidence: new feature tests fail, regression baseline green |
| 2c (Refactor) | Green phase evidence: all tests (target + regression) pass |
| 3 (Adversarial Review) | Tests pass post-refactor; strict mode also requires approved sprint contract + matching contract-review PASS |
| 5 (Formal Hardening) | Adversary verdict PASS on implementation, or explicit Phase 4 feedback routing whose current sprint findings all target Phase 5 |
| 6 (Convergence Check) | `verification-report.md`, `security-report.md`, and `purity-audit.md` exist with required sections, all were recorded after entering Phase 5, `verification/security-results/` is non-empty with at least one post-Phase-5 artifact, all required proof obligations are `proved`, and every persisted finding has matching `adversary-finding` bead coverage |

## Write Restrictions by Phase

Source code files (src/, lib/, main implementation) may NOT be written during:
- init, 1a, 1b, 1c (spec phases - no code yet)

Test files may NOT be written during:
- init, 1a, 1b (before spec gate)

Spec files may only be modified during:
- 1a, 1b, 1c (spec phases)
- 4 (feedback loop if routed to 1a or 1b)

## Iteration Limits (Safety Valve)

| Phase | Max Iterations | On Exceed |
|-------|---------------|-----------|
| 1c (Spec Review) | 3 | Escalate to human |
| 3 (Implementation Review, strict) | 5 | Escalate to human |
| 3 (Implementation Review, lean) | 3 | Escalate to human |
| 6 (Convergence) | 2 | Escalate to human |

When an iteration limit is reached, an escalation record is written to escalations/ and the pipeline pauses for human intervention.

## Lean Mode Relaxations

In lean mode, the following gates are relaxed:
- Phase 1c does not require explicit human approval
- Sprint contracts are only expected for risky or ambiguous work
- Phase 3 iteration cap is lower (3 instead of 5)
- Required proof obligations may be zero
- Gate enforcement hooks use standard profile (not strict)

Lean mode still traverses all 6 phases. It does not skip Phase 1b, Phase 2c, or Phase 5.
