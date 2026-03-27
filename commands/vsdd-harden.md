---
description: Run Phase 5 (formal hardening) for the active VSDD feature. Invokes vsdd-verifier to execute verification tier tools (Kani, hypothesis, fast-check, proptest) against required proof obligations.
---

## What
Runs formal hardening (Phase 5). Invokes the vsdd-verifier agent to execute language-appropriate verification tools against the proof obligations defined in Phase 1b. Produces a verification report.

## When
Run after adversarial review PASS (Phase 3 gate passed). Requires active feature at phase `5`.

In lean mode with no proof obligations, this phase is automatically SKIPped.

## How

1. **Read proof obligations** from `state.json.proofObligations`
2. **Filter required obligations**: skip Tier 0 and non-required obligations
3. **If no required obligations**: record gate SKIP, transition to Phase 6
4. **Invoke vsdd-verifier agent** for each obligation:
   - Write proof harness to `verification/proof-harnesses/`
   - Run appropriate tool (Kani, hypothesis, fast-check)
   - Capture results to `verification/fuzz-results/` or `verification/mutation-results/`
   - Update obligation status in state.json
5. **Write verification-report.md** with all results
6. **Transition to Phase 6** if all required obligations pass

## Language profile resolution

1. **`state.json.language`** (canonical; set by `initFeature(..., language)` at `/vsdd-init`)
2. Else **`.vsdd/index.json` → `features.<name>.language`** (denormalized cache)
3. Else treat as **unspecified** — verifier should infer from the repo (lockfiles, extensions) or ask the human.

Use `getLanguageForFeature(featureName)` from `scripts/lib/vsdd-state.js` for (1)+(2).

Load tool hints from the installed plugin copy of `manifests/language-profiles.json` (tiers, install commands, red/green/coverage commands) for the resolved language.

## Examples

```bash
/vsdd-harden
/vsdd-harden --tier 1    # run only Tier 1 tools (property tests/fuzzing)
/vsdd-harden --skip-optional    # skip non-required obligations
```
