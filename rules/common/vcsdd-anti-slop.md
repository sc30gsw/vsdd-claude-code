# VCSDD Anti-Slop Bias Rules

## What is "Slop"?

Slop is AI-generated code that appears correct but contains hidden deficiencies. It passes surface-level review but fails under scrutiny. VCSDD assumes ALL first-pass AI output is slop until proven otherwise.

## Detection Signals

Watch for these anti-patterns in AI-generated code:

### Structural Slop
- Generic names: handleData, processInput, utils.js - names that could apply to anything
- Over-abstraction: Creating interfaces/abstractions for single implementations
- Premature generalization: Making things configurable when only one configuration exists
- Framework mimicry: Copying framework patterns without understanding why they exist

### Logic Slop
- Happy path only: Missing error handling for real failure modes
- Shallow validation: Checking types but not business rules
- Default-value hiding: Using defaults that mask missing data
- Silent failures: Catching exceptions and doing nothing

### Test Slop
- Mirror tests: Tests that mirror implementation rather than testing behavior
- Missing edge cases: No tests for boundary values, empty inputs, concurrent access
- Weak assertions: Testing that code runs without checking what it produces
- Mocked reality: Mocking so aggressively that tests do not test anything real

## Enforcement

During adversarial review (Phase 3), the Adversary MUST:
1. Actively look for slop patterns in all reviewed code
2. Flag any instance with severity: high or above
3. Cite the specific file, line range, and slop pattern detected
4. Recommend concrete remediation (not just "fix this")

The Builder MUST NOT:
1. Dismiss slop findings as "stylistic preferences"
2. Claim first-pass code is "good enough"
3. Skip refactoring because "it works"
