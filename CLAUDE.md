# VSDD - Verified Spec-Driven Development

VSDD is a methodology that fuses Spec-Driven Development (SDD), Test-Driven Development (TDD), and Verification-Driven Development (VDD) into a unified workflow with adversarial quality gates.

## Overview

VSDD enforces structured quality gates through 6 phases, 4 roles, and 8 principles. It is designed for AI-assisted development where the risk of "AI slop" (code that looks correct but harbors hidden deficiencies) requires systematic countermeasures.

## Operating Modes

### Strict Mode
Full VSDD ceremony for high-assurance work:
- Sprint contracts required per sprint
- Multiple adversary review rounds
- Proof obligations enforced
- All 6 phases traversed
- Gate enforcement via strict hook profile

### Lean Mode
Streamlined flow for product work and prototyping:
- Planner -> Builder -> Evaluator flow
- Sprint contracts only for risky work
- Optional formal verification
- Relaxed gate enforcement
- Faster iteration cycles

## 6 Phases

### Phase 1: Spec Crystallization
- **1a**: Behavioral specification (EARS format requirements, edge case catalog)
- **1b**: Verification architecture (purity boundary map, proof obligations)
- **1c**: Spec review gate (adversary reviews spec, human approves)

### Phase 2: Test-First Implementation (TDD Core)
- **2a**: Test generation (Red phase - tests must fail)
- **2b**: Implementation (Green phase - make tests pass)
- **2c**: Refactor (maintain green, improve structure)

### Phase 3: Adversarial Review
Fresh-context adversary reviews implementation against spec. Binary PASS/FAIL across 5 dimensions:
1. Spec Fidelity
2. Edge Case Coverage
3. Implementation Correctness
4. Structural Integrity
5. Verification Readiness

### Phase 4: Feedback Integration
Routes adversary findings to the appropriate phase:
- Spec ambiguity -> Phase 1a
- Missing edge cases -> Phase 1a + 2a
- Test quality issues -> Phase 2a
- Implementation bugs -> Phase 2b
- Code structure issues -> Phase 2c
- Proof gaps -> Phase 5

### Phase 5: Formal Hardening
Verification tier execution:
- Tier 0: No formal proof (tests + review only)
- Tier 1: Property tests / fuzzing / mutation
- Tier 2: Lightweight formal methods for pure-core logic
- Tier 3: Strong formal proof for safety-critical invariants

### Phase 6: Convergence
Exit only when four-dimensional convergence is achieved:
1. Specs survive adversarial review
2. Tests provide adequate coverage
3. Implementation passes all tests
4. All required proofs pass

## 4 Roles

| Role | Actor | Responsibility |
|------|-------|---------------|
| Architect | Human | Strategic vision, spec approval, dispute arbitration |
| Builder | LLM (sonnet) | Spec authorship, test generation, implementation |
| Adversary | LLM (opus, fresh context) | Hyper-critical review, zero tolerance |
| Verifier | LLM (sonnet) | Formal verification coordination |

## Traceability

Every artifact is tracked via the Chainlink bead system:

    Spec Requirement (REQ-XXX)
      -> Verification Property (PROP-XXX)
      -> Test Case (TEST-XXX)
      -> Implementation (IMPL-XXX)
      -> Adversary Finding (FIND-XXX)
      -> Formal Proof (PROOF-XXX)

## Getting Started

1. Install: `bash install.sh --profile standard`
2. Initialize: `/vsdd-init <feature-name> --mode lean`
3. Write spec: `/vsdd-spec`
4. Generate tests: `/vsdd-tdd`
5. Implement: `/vsdd-impl`
6. Review: `/vsdd-adversary`
7. Check status: `/vsdd-status`
