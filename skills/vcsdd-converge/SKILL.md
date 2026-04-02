---
name: vcsdd-converge
description: Run Phase 6 (convergence check) for the active VCSDD feature. Validates four-dimensional convergence: finding diminishment, finding specificity, criteria coverage, and duplicate detection.
---

## What
Runs the convergence check (Phase 6). Validates all four convergence dimensions and either marks the feature complete or routes back to Phase 3 for another adversary pass.

## When
Run after Phase 5 (formal hardening) completes. Requires active feature at phase `6`.

## How

1. **Check finding diminishment**: compare `convergenceSignals.findingCount` across iterations
   - Completion requires the current sprint to reach `findingCount = 0`
   - For iterations beyond the first, completion also requires `findingCount < previousFindingCount`
2. **Check finding specificity**: verify all `evidence.filePath` values are real files
   ```bash
   for f in reviews/sprint-*/output/findings/*.json; do
     path=$(jq -r '.evidence.filePath' "$f")
     ls "$path" 2>/dev/null || echo "HALLUCINATED: $path"
   done
   ```
3. **Check criteria coverage**: verify `reviews/sprint-N/output/verdict.json` sets `convergenceSignals.allCriteriaEvaluated = true` and that `convergenceSignals.evaluatedCriteria` matches the approved contract's `CRIT-XXX` set exactly
   - every contract criterion must be listed
   - no extra criterion IDs may appear
4. **Check duplicate detection**: `convergenceSignals.duplicateFindings` must be empty
5. **Check open finding beads**: no `adversary-finding` bead may remain in `open` status
6. **Check formal hardening artifacts**:
   - `verification/verification-report.md` exists and was written after entering Phase 5
   - `verification/security-report.md` exists and was written after entering Phase 5
   - `verification/purity-audit.md` exists and was written after entering Phase 5
   - `verification/security-results/` contains at least one captured output artifact written after entering Phase 5
   - all required proof obligations are `proved` (required obligations may not finish as `skipped`)
7. **Check finding traceability coverage**:
   - every persisted `reviews/sprint-*/output/findings/FIND-NNN.json` must have a matching `adversary-finding` bead
8. **All 4 dimensions converged?**
   - YES: record gate PASS, transition to `complete`, display success summary
   - NO: record failure details, check iteration limit (max 2)
     - Under limit: route back to Phase 3 for re-review
     - Over limit: write escalation, pause for human

## Convergence Report

Display upon completion:
```
VCSDD Feature Complete: my-feature
   Sprint: 2 | Iterations: 3 | Mode: strict

   Convergence Dimensions:
   Finding Diminishment: 8 -> 3 -> 0
   Finding Specificity: All citations verified
   Criteria Coverage: 5/5 criteria evaluated
   No Duplicate Findings

   Traceability Chain:
   REQ-001 -> TEST-001 -> IMPL-001
   REQ-002 -> TEST-002 -> IMPL-002
   PROP-001 -> proof-harnesses/parser.rs
```

## Examples

```bash
/vcsdd-converge
/vcsdd-converge --force-complete    # override convergence (human sign-off)
```
