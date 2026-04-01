---
name: vcsdd-adversarial-refinement
description: Use this skill when running or interpreting VCSDD adversarial reviews. Provides calibration guidance for the Adversary agent, finding severity classification, and anti-leniency enforcement patterns.
origin: VCSDD
---

# VCSDD Adversarial Refinement

## When to Activate
- Phase 3 (adversarial review)
- Interpreting adversary findings
- Calibrating review intensity

## Adversary Calibration Principles

The Adversary MUST:
1. **Never** say "overall looks good" or equivalent
2. **Always** cite real file paths and line numbers
3. **Always** produce a binary PASS or FAIL per dimension
4. **Never** soften findings with qualifiers like "minor" or "nitpick"
5. **Always** specify `routeToPhase` for actionable routing

## Severity Classification

| Severity | Definition | Examples |
|----------|------------|---------|
| critical | Pipeline cannot continue | Missing spec requirement entirely, security vulnerability |
| high | Significant defect requiring rework | Wrong return type, missing error handling, untested edge case |
| medium | Defect that reduces quality | Misleading name, unnecessary abstraction, dead code |
| low | Improvement opportunity | Style inconsistency, minor duplication |

## Common Leniency Traps

Watch for these patterns and reject them:
- "The code handles most cases" → HOW MANY? WHICH ONES MISSING?
- "Error handling is adequate" → ADEQUATE BY WHAT STANDARD?
- "Generally follows the spec" → WHICH REQUIREMENTS ARE MISSING?
- "Minor refactoring could help" → IS THIS STRUCTURAL_INTEGRITY FAIL OR NOT?

## Finding Routing Guide

| Category | Meaning | Route To |
|----------|---------|----------|
| spec_ambiguity | Requirement or contract wording is ambiguous | 1a |
| spec_gap | Behavior exists but spec/contract does not cover it | 1a |
| requirement_mismatch | Spec is clear, but tests or implementation do not satisfy it | 2b |
| missing_edge_case | Edge case absent from spec or tests | 1a or 2a |
| test_coverage | Required behavior has no meaningful test | 2a |
| test_quality | Tautological or over-mocked test, or implementation-detail assertion | 2a |
| implementation_bug | Logic defect | 2b |
| error_handling | Incorrect or missing error path | 2b |
| security_surface | Validation/auth/injection issue | 2b |
| code_structure | Cohesion/abstraction/organization issue | 2c |
| naming | Misleading or imprecise names | 2c |
| duplication | Repeated logic that should be unified | 2c |
| proof_gap | Missing proof harness or unverifiable claim | 5 |
| invariant_violation | Proof/testing evidence contradicts required invariant | 5 |
| purity_boundary | Supposedly pure logic still depends on effects | 2c or 5 |
