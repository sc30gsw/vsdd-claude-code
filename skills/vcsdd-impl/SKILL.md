---
name: vcsdd-impl
description: "Run Phase 2b (Green phase) and Phase 2c (Refactor) for the active VCSDD feature. Implements minimal code to pass failing tests, then refactors while keeping tests green. Use when implementing feature code, making tests pass, or running the TDD green and refactor phases."
---

## How

### Phase 2b (Green)
1. **Transition to 2b**:
   ```javascript
   const { transitionPhase } = require(path.join(pluginRoot, 'scripts/lib/vcsdd-state.js'));
   transitionPhase(featureName, '2b');
   ```
2. **Read failing tests**: understand what each test requires
3. **Invoke vcsdd-builder agent** to implement:
   - Minimum code to make each failing test pass
   - Follow spec requirements exactly — no extra features
   - Stay within the purity boundary defined in Phase 1b
4. **Create implementation beads**: one per implemented function, linked to test-case beads
5. **Run tests and verify ALL pass**:
   ```bash
   npm test 2>&1 | tee .vcsdd/features/FEATURE_NAME/evidence/sprint-N-green-phase.log
   ```
6. **Record green phase evidence** with markers at the top of the log:
   ```text
   target-feature-tests: PASS
   regression-baseline: PASS
   ```

### Phase 2c (Refactor)
7. **Transition to 2c**: `transitionPhase(featureName, '2c')`
8. **Invoke vcsdd-builder agent** to refactor — do NOT add features, change behavior, or modify spec
9. **Verify tests still pass** after each refactor step
10. **Refresh green evidence** after the final refactor run with `target-feature-tests: PASS` and `regression-baseline: PASS`
11. **In strict mode**: update sprint contract in `contracts/sprint-N.md`, then run `/vcsdd-contract-review` before `/vcsdd-adversary`

## Examples

```bash
/vcsdd-impl
```
