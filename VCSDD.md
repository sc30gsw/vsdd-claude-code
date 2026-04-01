# VCSDD Methodology Overview

VCSDD stands for Verified Spec-Driven Development.

It combines four constraints into one workflow:

1. Spec-first: define behavioral requirements before code.
2. Red-before-green: write failing tests before implementation.
3. Adversarial review: use a fresh-context reviewer that judges only from artifacts on disk.
4. Selective formal hardening: require proof where the feature declares required obligations, while still producing security and purity audit artifacts for every Phase 5 pass.

## Phases

1. `1a` Behavioral specification
2. `1b` Verification architecture
3. `1c` Spec review gate
4. `2a` Test generation (Red)
5. `2b` Implementation (Green)
6. `2c` Refactor
7. `3` Adversarial review
8. `4` Feedback routing
9. `5` Formal hardening
10. `6` Convergence

## Modes

- `lean`: traverses all 6 phases with lighter approval and contract requirements, intended for normal product work.
- `strict`: traverses all 6 phases with sprint contracts, adversarial contract review before Phase 3, verdicts bound to the approved contract snapshot, stronger review gates, and tighter convergence requirements.

## Required Artifacts

- `specs/behavioral-spec.md`
- `specs/verification-architecture.md`
- `evidence/sprint-N-red-phase.log` with:
  - `new-feature-tests: FAIL`
  - `regression-baseline: PASS`
- `evidence/sprint-N-green-phase.log` with:
  - `target-feature-tests: PASS`
  - `regression-baseline: PASS`
- `reviews/contracts/sprint-N/output/verdict.json` with `overallVerdict: PASS`, matching `reviewContext.contractPath`, and matching `reviewContext.contractDigest` in strict mode
- `reviews/sprint-N/output/verdict.json`
- `verification/verification-report.md`
- `verification/security-report.md`
- `verification/purity-audit.md`
- at least one captured artifact under `verification/security-results/`, recorded after entering Phase 5

## Completion Rule

A feature is complete only when:

- the latest adversary verdict is `PASS`
- current convergence finding count is zero
- no duplicate findings remain
- no `adversary-finding` bead remains open
- every persisted adversary finding has a matching `adversary-finding` bead
- all required proof obligations are proved, and persisted findings across `reviews/sprint-*/output/findings/` retain bead coverage
- formal hardening artifacts (`verification-report.md`, `security-report.md`, `purity-audit.md`) exist
- in strict mode, `convergenceSignals.evaluatedCriteria` exactly matches the approved contract's `CRIT-XXX` set

## Traceability

Every requirement, test, implementation change, finding, and proof can be linked through the bead graph in `.vcsdd/features/<feature>/state.json`.
