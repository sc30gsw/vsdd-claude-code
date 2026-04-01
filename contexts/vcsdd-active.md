# VCSDD Active Pipeline Context

This context is loaded when a VCSDD feature pipeline is active. It provides the current pipeline state and behavioral guidance for all agents in this session.

## Behavioral Mode

When VCSDD is active:
- All file writes are subject to phase-based gate enforcement
- Spec files (`specs/`) may only be modified during phases 1a, 1b, 1c, and 4 (feedback)
- Test files may not be written during phases init, 1a, 1b, and 1c
- Source implementation files may not be written during phases init through 1c

## Phase Reference

| Phase | Name | Allowed Writes | Command |
|-------|------|---------------|---------|
| init | Initializing | .vcsdd/ only | /vcsdd-spec |
| 1a | Behavioral Spec | specs/behavioral-spec.md | /vcsdd-spec |
| 1b | Verification Arch | specs/verification-architecture.md | /vcsdd-spec |
| 1c | Spec Review Gate | review verdicts only | /vcsdd-spec-review |
| 2a | Test Generation (Red) | tests/ only | /vcsdd-tdd |
| 2b | Implementation (Green) | src/ tests/ | /vcsdd-impl |
| 2c | Refactor | src/ tests/ contracts/ contract-review artifacts | /vcsdd-impl, /vcsdd-contract-review |
| 3 | Adversarial Review | review output only | /vcsdd-adversary |
| 4 | Feedback Routing | routed phase files | /vcsdd-feedback |
| 5 | Formal Hardening | verification/ | /vcsdd-harden |
| 6 | Convergence Check | .vcsdd/ state only | /vcsdd-converge |

## Active Commands

- `/vcsdd-status` - Show current pipeline state
- `/vcsdd-trace <bead-id>` - Show traceability chain
- `/vcsdd-contract-review` - Review the strict-mode sprint contract
- `/vcsdd-commit` - Commit current phase artifacts

## State Files

- Active feature: `.vcsdd/index.json` → `activeFeature` (mirrored to `.vcsdd/active-feature.txt`)
- Pipeline state: `.vcsdd/features/<name>/state.json`
- Feature index: `.vcsdd/index.json`
- Audit log: `.vcsdd/history.jsonl`
