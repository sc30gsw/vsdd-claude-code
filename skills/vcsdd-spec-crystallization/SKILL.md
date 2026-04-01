---
name: vcsdd-spec-crystallization
description: Use this skill when writing Phase 1a behavioral specifications in VCSDD. Provides EARS format requirements writing, purity boundary analysis, edge case enumeration, and spec quality validation patterns.
origin: VCSDD
---

# VCSDD Spec Crystallization

## When to Activate
- Phase 1a of VCSDD pipeline (behavioral specification)
- Writing EARS-format requirements
- Identifying edge cases for a feature
- Reviewing a behavioral spec for completeness

## EARS Requirement Format

Every requirement MUST use EARS (Easy Approach to Requirements Syntax):

| Pattern | Syntax | Example |
|---------|--------|---------|
| Ubiquitous | THE SYSTEM SHALL [action] | THE SYSTEM SHALL log all authentication attempts |
| Event-driven | WHEN [trigger] THE SYSTEM SHALL [action] | WHEN user submits empty form THE SYSTEM SHALL return ErrorCode.EMPTY |
| State-driven | WHILE [state] THE SYSTEM SHALL [action] | WHILE user is authenticated THE SYSTEM SHALL display dashboard |
| Conditional | IF [condition] THEN THE SYSTEM SHALL [action] | IF retry count exceeds 3 THEN THE SYSTEM SHALL lock account |
| Optional | WHERE [feature] THE SYSTEM SHALL [action] | WHERE audit mode enabled THE SYSTEM SHALL record all reads |

## Spec Completeness Checklist

- [ ] Every requirement has a unique ID (REQ-001, REQ-002, ...)
- [ ] Every requirement uses EARS syntax
- [ ] Every requirement is testable (can be pass/fail verified)
- [ ] Edge case catalog includes: empty inputs, boundary values, concurrent access, error conditions
- [ ] Non-functional requirements specified (performance bounds, security constraints)
- [ ] Purity boundary identified: pure core vs effectful shell

## Purity Boundary Analysis

Separate code into:
- **Pure Core**: deterministic functions, no side effects, same input → same output always
  - Example: parsing logic, business rules, validation, calculations
  - Formally verifiable with Kani/hypothesis/fast-check
- **Effectful Shell**: I/O, database, network, time, randomness
  - Example: file readers, HTTP clients, database queries
  - Tested with integration tests and mocks at the boundary

## Edge Case Catalog Template

```markdown
## Edge Cases

### Input Edge Cases
- Empty input: [expected behavior]
- Maximum length input: [expected behavior]
- Special characters / unicode: [expected behavior]
- Null / undefined: [expected behavior]

### State Edge Cases
- First-time run (no state): [expected behavior]
- Concurrent modification: [expected behavior]
- Interrupted operation: [expected behavior]

### Error Edge Cases
- External dependency unavailable: [expected behavior]
- Partial failure: [expected behavior]
- Timeout: [expected behavior]
```
