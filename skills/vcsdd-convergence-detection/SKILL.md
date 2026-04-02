---
name: vcsdd-convergence-detection
description: Use this skill during Phase 6 convergence checks. Provides four-dimensional convergence analysis, hallucination detection, and duplicate finding identification.
origin: VCSDD
---

# VCSDD Convergence Detection

## When to Activate
- Phase 6 (convergence check)
- Comparing adversary review iterations
- Detecting hallucinated file references

## Four Convergence Dimensions

### 1. Finding Diminishment
Compare finding counts across iterations:
```
Iteration 1: 8 findings
Iteration 2: 4 findings  <- diminishment ok
Iteration 3: 6 findings  <- NOT diminishing (re-review needed)
```
Convergent when: monotonically decreasing OR zero findings.

### 2. Finding Specificity (Hallucination Detection)
For every finding, verify `evidence.filePath` is a real file:
```bash
for finding in .vcsdd/features/<name>/reviews/sprint-*/output/findings/*.json; do
  filepath=$(jq -r '.evidence.filePath' "$finding")
  ls "$filepath" 2>/dev/null || echo "HALLUCINATED: $filepath in $finding"
done
```
Convergent when: zero hallucinated file paths.

### 3. Criteria Coverage
All contract criteria must have been evaluated:
- Read `contracts/sprint-N.md` for all CRIT-XXX IDs
- Verify each CRIT-XXX appears in grading verdict
Convergent when: all criteria evaluated.

### 4. Duplicate Detection
Compare current findings against previously-addressed findings:
- A finding is a duplicate if it describes the same issue as a FIND-XXX that has `resolution.status = "fixed"`
Convergent when: zero duplicates.

## Convergence Verdict

```
CONVERGED = all 4 dimensions satisfied
NOT CONVERGED = any dimension fails -> route back to Phase 3
ESCALATE = convergence iteration limit (2) exceeded -> human review
```
