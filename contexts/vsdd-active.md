# VSDD Active Pipeline Context

This context is loaded when a VSDD feature pipeline is active. It provides the current pipeline state and behavioral guidance for all agents in this session.

## Behavioral Mode

When VSDD is active:
- All file writes are subject to phase-based gate enforcement
- Spec files (`specs/`) may only be modified during phases 1a, 1b, 1c, and 4 (feedback)
- Test files may not be written during phases init, 1a, 1b
- Source implementation files may not be written during phases init through 1c

## Phase Reference

| Phase | Name | Allowed Writes | Command |
|-------|------|---------------|---------|
| init | Initializing | .vsdd/ only | /vsdd-spec |
| 1a | Behavioral Spec | specs/behavioral-spec.md | /vsdd-spec |
| 1b | Verification Arch | specs/verification-architecture.md | /vsdd-spec |
| 1c | Spec Review Gate | review verdicts only | /vsdd-spec-review |
| 2a | Test Generation (Red) | tests/ only | /vsdd-tdd |
| 2b | Implementation (Green) | src/ tests/ | /vsdd-impl |
| 2c | Refactor | src/ tests/ | /vsdd-impl |
| 3 | Adversarial Review | review output only | /vsdd-adversary |
| 4 | Feedback Routing | routed phase files | /vsdd-feedback |
| 5 | Formal Hardening | verification/ | /vsdd-harden |
| 6 | Convergence Check | .vsdd/ state only | /vsdd-converge |

## Active Commands

- `/vsdd-status` - Show current pipeline state
- `/vsdd-trace <bead-id>` - Show traceability chain
- `/vsdd-commit` - Commit current phase artifacts

## State Files

- Active feature: `.vsdd/index.json` → `activeFeature` (mirrored to `.vsdd/active-feature.txt`)
- Pipeline state: `.vsdd/features/<name>/state.json`
- Feature index: `.vsdd/index.json`
- Audit log: `.vsdd/history.jsonl`
