---
name: vcsdd-grading-criteria
description: Use this skill when evaluating VCSDD grading dimensions during adversarial review. Provides concrete evaluation checklists for each of the 5 dimensions and convergence signal detection.
origin: VCSDD
---

# VCSDD Grading Criteria

## When to Activate
- During Phase 3 adversarial review
- Evaluating convergence signals in Phase 6
- Writing evidence blocks for verdicts

## Dimension Evaluation Checklists

### spec_fidelity
- [ ] Extract all REQ-XXX IDs from behavioral-spec.md
- [ ] For each REQ-XXX: find the corresponding test(s) in test files
- [ ] For each REQ-XXX: find the corresponding implementation
- [ ] Check for unspecified features in implementation

### edge_case_coverage
- [ ] Extract edge case catalog from behavioral-spec.md
- [ ] For each edge case: find the corresponding test
- [ ] Identify edge cases the spec MISSED (fuzzer thinking)
- [ ] Check boundary values (off-by-one, MAX_INT, empty collections)

### implementation_correctness
- [ ] Trace each function's logic against its spec requirement
- [ ] Check all error paths (what happens when dependency fails?)
- [ ] Look for null/undefined dereferences
- [ ] Check concurrent access assumptions
- [ ] Look for resource leaks (unclosed files, connections)

### structural_integrity
- [ ] Functions are focused (single responsibility)
- [ ] Names match their purpose precisely
- [ ] No copy-paste duplication
- [ ] Abstraction level consistent with surrounding code
- [ ] No dead code or commented-out blocks

### verification_readiness
- [ ] Pure functions take only primitives/data, return Result/Either
- [ ] Side effects confined to effectful shell modules
- [ ] Functions are small enough to reason about formally
- [ ] Proof obligations from verification-architecture.md are reflected in code structure

## Evidence Requirements

Every PASS verdict must include evidence blocks with:
- `type`: file | test-output | coverage | proof-result
- `location`: real file path (must be verifiable with ls)
- `description`: what was verified at that location
