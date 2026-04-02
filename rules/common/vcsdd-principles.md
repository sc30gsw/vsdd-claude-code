# VCSDD Core Principles

These principles govern all VCSDD pipeline operations. They are non-negotiable and always active.

## 1. Spec Supremacy

The specification is the highest authority beneath the human developer. All implementation decisions must trace back to a spec requirement. Code that cannot be justified by the spec is unauthorized code.

- Never implement features not in the spec
- When spec and implementation disagree, the spec wins
- Spec changes require re-evaluation of all downstream artifacts

## 2. Verification-First Architecture

Formal provability shapes the design, not vice versa. During spec crystallization, identify the purity boundary: a deterministic, side-effect-free core (formally verifiable) surrounded by an effectful shell (I/O, database, network).

- Design for testability and provability from the start
- Separate pure logic from side effects at the architectural level
- Proof obligations are defined during spec phase, not retrofitted

## 3. Red Before Green

No implementation code until a failing test demands it. The Red phase (Phase 2a) generates tests that MUST fail before any implementation begins. The regression baseline must remain green while new feature tests are red.

- Write tests first, always
- New feature tests must fail before implementation (evidence required)
- Existing regression tests must continue passing during Red phase
- Green phase evidence: all tests (new + regression) pass

## 4. Anti-Slop Bias

The first "correct" version is assumed to contain hidden debt. AI-generated code that "works" on first pass should receive extra scrutiny, not less. Look for:

- Generic patterns that do not fit the specific problem
- Missing edge cases that a human would catch
- Over-abstraction or premature generalization
- Copy-paste patterns from training data
- "Good enough" implementations that hide subtle bugs

## 5. Forced Negativity

Adversarial pressure bypasses politeness filters. The Adversary agent is prohibited from:

- Saying "overall looks good" or equivalent
- Providing balanced feedback (it must be purely critical)
- Softening findings with qualifiers
- Accepting work without concrete evidence

Every review MUST produce findings or explicitly justify PASS with evidence.

## 6. Linear Accountability

Every spec item, test, and line of code is tracked via the Chainlink bead traceability system. At any point you can ask "Why does this code exist?" and trace it through:

    Spec Requirement -> Verification Property -> Test Case -> Implementation -> Review Finding -> Formal Proof

Orphan artifacts (code without spec justification, tests without requirements) are flagged.

## 7. Entropy Resistance

Context resets on every adversarial pass. The Adversary is spawned as a fresh agent instance with zero conversational context from the Builder. This prevents:

- Familiarity bias (accepting code because you have seen it develop)
- Anchoring to previous review rounds
- Accumulation of implicit assumptions
- Degradation of review quality over iterations

## 8. Four-Dimensional Convergence

"Done" means specs, tests, implementation, AND all required proofs are proved under adversarial scrutiny. Phase 6 convergence requires:

1. Finding diminishment: Monotonically decreasing findings count across iterations
2. Finding specificity: All findings cite real files and line numbers (hallucination detection)
3. Grading criteria coverage: All contract criteria evaluated
4. Duplicate detection: No regurgitation of previously-addressed findings
5. Formal hardening evidence: required reports exist with the mandated sections, were generated after entering Phase 5, `security-results/` contains execution evidence from the current hardening pass, and every persisted finding has a matching `adversary-finding` bead
