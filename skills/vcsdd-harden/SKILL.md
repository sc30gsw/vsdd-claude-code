---
name: vcsdd-harden
description: Run Phase 5 (formal hardening) for the active VCSDD feature. Invokes vcsdd-verifier to execute proof obligations, security hardening, and a purity-boundary audit before convergence.
---

## What
Runs formal hardening (Phase 5). Invokes the vcsdd-verifier agent to execute language-appropriate verification tools against the proof obligations defined in Phase 1b, run security hardening checks, and audit the purity boundary. Produces `verification-report.md`, `security-report.md`, and `purity-audit.md`.

## When
Run once the feature is already at phase `5`. This happens either after adversarial review PASS (`3 -> 5`) or after Phase 4 explicitly routes the current sprint's findings to Phase `5` (`3 -> 4 -> 5`) for proof-gap / invariant-only hardening work.

## How

1. **Read proof obligations** from `state.json.proofObligations`
2. **Filter required obligations**: skip Tier 0 and non-required obligations
3. **Run security hardening regardless of proof count**:
   - execute Semgrep/Wycheproof/project-appropriate equivalents when relevant
   - capture raw outputs under `verification/security-results/`
   - summarize results in `verification/security-report.md`
4. **Audit purity boundaries regardless of proof count**:
   - compare the implemented core/shell split against `specs/verification-architecture.md`
   - write findings and residual risks to `verification/purity-audit.md`
5. **If no required obligations**: still write a lightweight verification report that documents the absence of required proofs, the security sweep, and the purity audit
6. **Invoke vcsdd-verifier agent** for each obligation:
   - Write proof harness to `verification/proof-harnesses/`
   - Run appropriate tool (Kani, hypothesis, fast-check)
   - Capture results to `verification/fuzz-results/` or `verification/mutation-results/`
   - Update obligation status in state.json
7. **Write verification-report.md** with proof results and any graceful degradation
   - required sections: `## Proof Obligations`, `## Summary`
   - required obligations must end as `proved`; a `required` obligation left as `skipped` blocks Phase 6
8. **Write security/purity artifacts with required structure**
   - `verification/security-report.md` must include `## Tooling` and `## Summary`
   - `verification/purity-audit.md` must include `## Declared Boundaries`, `## Observed Boundaries`, and `## Summary`
   - `verification/security-results/` must contain at least one captured output file, even if the tools were not applicable
9. **Transition to Phase 6** only when:
   - all required obligations are `proved`
   - `verification/verification-report.md` exists and was written after entering Phase 5
   - `verification/security-report.md` exists and was written after entering Phase 5
   - `verification/purity-audit.md` exists and was written after entering Phase 5
   - `verification/security-results/` contains at least one captured output artifact written after entering Phase 5

## Language profile resolution

1. **`state.json.language`** (canonical; set by `initFeature(..., language)` at `/vcsdd-init`)
2. Else **`.vcsdd/index.json` → `features.<name>.language`** (denormalized cache)
3. Else treat as **unspecified** — verifier should infer from the repo (lockfiles, extensions) or ask the human.

Use `getLanguageForFeature(featureName)` from `scripts/lib/vcsdd-state.js` for (1)+(2).

Load tool hints from the installed plugin copy of `manifests/language-profiles.json` (tiers, install commands, red/green/coverage commands) for the resolved language.

## Examples

```bash
/vcsdd-harden
/vcsdd-harden --tier 1    # run only Tier 1 tools (property tests/fuzzing)
/vcsdd-harden --skip-optional    # skip non-required obligations
```
