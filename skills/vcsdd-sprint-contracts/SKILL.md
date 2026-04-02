---
name: vcsdd-sprint-contracts
description: Use this skill when writing sprint contracts in VCSDD strict mode. Provides grading criteria patterns, dimension weight guidelines, and pass threshold formulation for the 5 review dimensions.
origin: VCSDD
---

# VCSDD Sprint Contracts

## When to Activate
- Phase 2c in strict mode (after refactor, before adversarial review)
- Writing grading criteria for a sprint
- Reviewing a sprint contract before approving

## 5 Review Dimensions

| Dimension | Focus | Typical Weight |
|-----------|-------|---------------|
| spec_fidelity | Do tests and code match the spec? | 0.30 |
| edge_case_coverage | Are edge cases from spec tested? | 0.25 |
| implementation_correctness | Is logic correct? | 0.25 |
| structural_integrity | Is code organized well? | 0.10 |
| verification_readiness | Is pure core isolatable? | 0.10 |

## Pass Threshold Formulation

Pass thresholds MUST be binary-evaluable (yes/no), NOT numeric:

**Good** (binary):
- "Every REQ-XXX ID in behavioral-spec.md has at least one test case"
- "All error return values are typed, not generic exceptions"
- "Pure parsing functions accept only primitives and return Result types"

**Bad** (subjective):
- "Code quality is good"
- "Most edge cases covered"
- "Reasonable error handling"

## Negotiation Protocol

1. Builder proposes contract → sets `status: draft`
2. Orchestrator runs `/vcsdd-contract-review` → adversary reviews criteria against spec/tests/source
3. Maximum 2 negotiation rounds (`negotiationRound` field)
4. Human approves final contract before Phase 3 by setting `status: approved`

## Sprint Contract Template

```markdown
---
sprintNumber: 1
feature: my-feature
scope: "Core parsing logic with error handling"
negotiationRound: 0
status: draft
criteria:
  - id: CRIT-001
    dimension: spec_fidelity
    description: All REQ-XXX items have corresponding test cases
    weight: 0.30
    passThreshold: Every requirement ID (REQ-NNN) in behavioral-spec.md appears in at least one test function name or test docstring
    beadId: BEAD-001
  - id: CRIT-002
    dimension: edge_case_coverage
    description: Critical edge cases from the spec are tested
    weight: 0.25
    passThreshold: Every critical edge case section in behavioral-spec.md has an explicit test
---
```
