---
description: Run Phase 6 (convergence check) for the active VSDD feature. Validates four-dimensional convergence: finding diminishment, finding specificity, criteria coverage, and duplicate detection.
---

## What
Runs the convergence check (Phase 6). Validates all four convergence dimensions and either marks the feature complete or routes back to Phase 3 for another adversary pass.

## When
Run after Phase 5 (formal hardening) completes. Requires active feature at phase `6`.

## How

1. **Check finding diminishment**: compare `convergenceSignals.findingCount` across iterations
   - Completion requires the current sprint to reach `findingCount = 0`
2. **Check finding specificity**: verify all `evidence.filePath` values are real files
   ```bash
   for f in reviews/sprint-*/output/findings/*.json; do
     path=$(jq -r '.evidence.filePath' "$f")
     ls "$path" 2>/dev/null || echo "HALLUCINATED: $path"
   done
   ```
3. **Check criteria coverage**: verify `reviews/sprint-N/output/verdict.json` sets `convergenceSignals.allCriteriaEvaluated = true` for all CRIT-XXX from the approved contract
4. **Check duplicate detection**: `convergenceSignals.duplicateFindings` must be empty
5. **Check open finding beads**: no `adversary-finding` bead may remain in `open` status
6. **All 4 dimensions converged?**
   - YES: record gate PASS, transition to `complete`, display success summary
   - NO: record failure details, check iteration limit (max 2)
     - Under limit: route back to Phase 3 for re-review
     - Over limit: write escalation, pause for human

## Convergence Report

Display upon completion:
```
VSDD Feature Complete: my-feature
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
/vsdd-converge
/vsdd-converge --force-complete    # override convergence (human sign-off)
```
