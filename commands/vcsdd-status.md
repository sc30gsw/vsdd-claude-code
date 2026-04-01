---
description: Display the current VCSDD pipeline status for the active (or specified) feature. Shows phase, mode, sprint count, open findings, pending proofs, and the traceability summary.
---

## What
Displays a comprehensive status view of the active VCSDD feature pipeline.

## When
Run at any time to check pipeline state. No phase restrictions.

## How

1. **Read index.json**: list all features with status
2. **Read active feature state.json**: full pipeline state
3. **Display status panel**:
   ```
   ================================================
   VCSDD Status: my-feature
   ================================================
   Phase:    2b (Implementation - Green)
   Mode:     strict
   Sprint:   1
   Iteration: 2 (of 5 max for this phase)

   Gates:
   1a -> 1b -> 1c (PASS) -> 2a -> 2b

   Open Findings: 0
   Pending Proofs: 2 (PROP-001, PROP-002)

   Traceability:
   12 spec requirements
   12 test cases (10 green, 2 red)
   8 implementations

   Next: Run /vcsdd-adversary (Phase 3)
   ================================================
   ```

## Examples

```bash
/vcsdd-status
/vcsdd-status --all-features    # show all features, not just active
/vcsdd-status --json            # machine-readable output
```
