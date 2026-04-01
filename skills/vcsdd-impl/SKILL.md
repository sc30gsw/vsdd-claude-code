---
name: vcsdd-impl
description: Run Phase 2b (implementation, Green phase) and Phase 2c (refactor) for the active VCSDD feature. Invokes vcsdd-builder to implement minimal code to pass failing tests, then refactor.
---

## What
Runs the Green phase (Phase 2b) and Refactor phase (Phase 2c). Implements minimal code to pass all failing tests, then refactors while keeping tests green.

## When
Run after `/vcsdd-tdd` completes Phase 2a with red phase evidence. Requires active feature at phase `2a`.

## How

### Phase 2b (Green)
1. **Transition to 2b**
2. **Read failing tests**: understand what each test requires
3. **Invoke vcsdd-builder agent** to implement:
   - Minimum code to make each failing test pass
   - Follow spec requirements exactly - no extra features
   - Stay within the purity boundary defined in Phase 1b
4. **Create implementation beads**: one per implemented function, linked to test-case beads
5. **Run tests** and verify ALL pass:
   ```bash
   npm test 2>&1 | tee .vcsdd/features/<name>/evidence/sprint-N-green-phase.log
   ```
6. **Record green phase evidence** with explicit markers at the top of the log:
   ```text
   target-feature-tests: PASS
   regression-baseline: PASS
   ```
7. **Append the raw passing output** after those markers so Phase 3 can prove both signals

### Phase 2c (Refactor)
8. **Transition to 2c**
9. **Invoke vcsdd-builder agent** to refactor:
   - Eliminate code duplication
   - Improve naming clarity
   - Extract functions with clear responsibilities
   - Do NOT add features, change behavior, or modify spec
10. **Verify tests still pass** after each refactor step
11. **Refresh green evidence** after the final refactor run, again including `target-feature-tests: PASS` and `regression-baseline: PASS`, so Phase 3 sees post-refactor test results
12. **In strict mode, update the sprint contract** in `contracts/sprint-N.md` so it reflects the final refactored artifact set, then run `/vcsdd-contract-review` before `/vcsdd-adversary`

## Examples

```bash
/vcsdd-impl
```
