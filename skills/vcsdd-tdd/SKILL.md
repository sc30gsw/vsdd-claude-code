---
name: vcsdd-tdd
description: Run Phase 2a (test generation, Red phase) for the active VCSDD feature. Invokes vcsdd-builder to generate failing tests for all spec requirements. Records red phase evidence.
---

## What
Runs the Red phase (Phase 2a): generates test cases for every requirement in the behavioral spec. Tests MUST FAIL before implementation begins. Records failure evidence.

## When
Run after spec review gate (Phase 1c) passes. Requires active feature at phase `1c`.

## How

1. **Read behavioral spec**: extract all REQ-XXX requirements
2. **Invoke vcsdd-builder agent** to generate tests:
   - One test function per requirement minimum
   - Additional tests for each edge case in spec
   - Tests for error conditions and boundary values
3. **Create test-case beads**: one per test function, linked to corresponding REQ-XXX bead
4. **Transition to 2a**: this starts sprint `N` for the current implementation cycle (`transitionPhase(feature, '2a')`)
5. **Run tests** and verify they FAIL:
   ```bash
   npm test 2>&1 | tee .vcsdd/features/<name>/evidence/sprint-N-red-phase.log
   ```
6. **Verify regression baseline**: run existing tests separately to confirm they still pass
7. **Record red phase evidence** in the active sprint with explicit markers at the top of the log:
   ```text
   new-feature-tests: FAIL
   regression-baseline: PASS
   ```
   For coverage-retrofit sprints (adding tests to already-implemented code):
   - Use `coverage-retrofit: true` instead of `new-feature-tests: failing`
   - Example:
     ```
     coverage-retrofit: true
     regression-baseline: PASS
     total-tests: 45
     new-tests-added: 3
     ```
8. **Append the raw failing test output** after those markers so the gate can prove both conditions
9. **Display summary**: sprint number, N tests generated, all failing as expected

## CRITICAL: Red Phase Validation
If ANY new test passes before implementation, STOP. The test is invalid (it's testing the wrong thing or the implementation already exists). Fix the test first.

## Examples

```bash
/vcsdd-tdd
/vcsdd-tdd --framework vitest    # specify test framework
/vcsdd-tdd --framework pytest
```
