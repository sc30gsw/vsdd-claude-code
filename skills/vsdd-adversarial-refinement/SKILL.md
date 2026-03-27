---
name: vsdd-adversarial-refinement
description: Use this skill when running or interpreting VSDD adversarial reviews. Provides calibration guidance for the Adversary agent, finding severity classification, and anti-leniency enforcement patterns.
origin: VSDD
---

# VSDD Adversarial Refinement

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

| Dimension | Finding Type | Route To |
|-----------|-------------|---------|
| spec_fidelity | Missing requirement | 1a (if spec ambiguous) or 2b (if impl wrong) |
| edge_case_coverage | Untested edge case | 2a (add test) |
| implementation_correctness | Logic error | 2b |
| structural_integrity | Code organization | 2c |
| verification_readiness | Purity boundary violated | 2b or 5 |
