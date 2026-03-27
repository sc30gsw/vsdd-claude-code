---
description: Run Phase 2b (implementation, Green phase) and Phase 2c (refactor) for the active VSDD feature. Invokes vsdd-builder to implement minimal code to pass failing tests, then refactor.
---

## What
Runs the Green phase (Phase 2b) and Refactor phase (Phase 2c). Implements minimal code to pass all failing tests, then refactors while keeping tests green.

## When
Run after `/vsdd-tdd` completes Phase 2a with red phase evidence. Requires active feature at phase `2a`.

## How

### Phase 2b (Green)
1. **Transition to 2b**
2. **Read failing tests**: understand what each test requires
3. **Invoke vsdd-builder agent** to implement:
   - Minimum code to make each failing test pass
   - Follow spec requirements exactly - no extra features
   - Stay within the purity boundary defined in Phase 1b
4. **Create implementation beads**: one per implemented function, linked to test-case beads
5. **Run tests** and verify ALL pass:
   ```bash
   npm test 2>&1 | tee .vsdd/features/<name>/evidence/sprint-N-green-phase.log
   grep -q "passing\|PASSED\|ok" sprint-N-green-phase.log
   ```

### Phase 2c (Refactor)
6. **Transition to 2c**
7. **Invoke vsdd-builder agent** to refactor:
   - Eliminate code duplication
   - Improve naming clarity
   - Extract functions with clear responsibilities
   - Do NOT add features, change behavior, or modify spec
8. **Verify tests still pass** after each refactor step
9. **Refresh green evidence** after the final refactor run so Phase 3 sees post-refactor test results

## Examples

```bash
/vsdd-impl
/vsdd-impl --skip-refactor    # lean mode: merge 2b and 2c
```
