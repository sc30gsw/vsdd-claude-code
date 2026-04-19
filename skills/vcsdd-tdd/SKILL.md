---
name: vcsdd-tdd
description: "Run Phase 2a (test generation, Red phase) for the active VCSDD feature. Generates failing tests for all spec requirements and records red phase evidence. Use when writing tests, starting TDD red phase, or generating test cases from the behavioral spec."
---

## How

1. **Read behavioral spec**: extract all REQ-XXX requirements from `specs/behavioral-spec.md`
2. **Invoke vcsdd-builder agent** to generate tests:
   - One test function per requirement minimum
   - Additional tests for each edge case in spec
   - Tests for error conditions and boundary values
3. **Create test-case beads**: one per test function, linked to corresponding REQ-XXX bead
4. **Transition to 2a**:
   ```javascript
   const { transitionPhase } = require(path.join(pluginRoot, 'scripts/lib/vcsdd-state.js'));
   transitionPhase(featureName, '2a'); // starts sprint N
   ```
5. **Run tests and verify they FAIL**:
   ```bash
   npm test 2>&1 | tee .vcsdd/features/FEATURE_NAME/evidence/sprint-N-red-phase.log
   ```
6. **If ANY new test passes**: STOP — the test is invalid (testing the wrong thing or implementation already exists). Fix the test before continuing.
7. **Verify regression baseline**: run existing tests separately to confirm they still pass
8. **Record red phase evidence** with markers at the top of the log:
   ```text
   new-feature-tests: FAIL
   regression-baseline: PASS
   ```
   For coverage-retrofit sprints, use `coverage-retrofit: true` instead of `new-feature-tests: FAIL`.
9. **Append raw failing test output** after markers so the gate can prove both conditions
10. **Display summary**: sprint number, N tests generated, all failing as expected

## Examples

```bash
/vcsdd-tdd
/vcsdd-tdd --framework vitest
/vcsdd-tdd --framework pytest
```
