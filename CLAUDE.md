# VCSDD - Verified Coherence Spec-Driven Development

VCSDD is a methodology that fuses Spec-Driven Development (SDD), Test-Driven Development (TDD), Verification-Driven Development (VDD), and Coherence-Driven Development (CoDD) into a unified workflow with adversarial quality gates and dependency-aware change propagation.

## Overview

VCSDD enforces structured quality gates through 6 phases, 4 roles, and 8 principles. It is designed for AI-assisted development where the risk of "AI slop" (code that looks correct but harbors hidden deficiencies) requires systematic countermeasures.

## Operating Modes

### Strict Mode
Full VCSDD ceremony for high-assurance work:
- Sprint contracts required per sprint
- Contract review PASS required before Phase 3, and the verdict must still match the approved contract snapshot
- Multiple adversary review rounds (Phase 3 capped at 5)
- Proof obligations enforced
- All 6 phases traversed
- Gate enforcement via strict hook profile

### Lean Mode
Streamlined flow for product work and prototyping:
- Full 6-phase VCSDD flow with lighter approvals and contract requirements
- Sprint contracts only for risky work
- Phase 3 review loops are capped lower (3)
- Phase 5 still runs, but required proof obligations are often zero
- Phase 5 still must produce `verification-report.md`, `security-report.md`, and `purity-audit.md`
- Relaxed gate enforcement
- Faster iteration cycles

## 6 Phases

### Phase 1: Spec Crystallization
- **1a**: Behavioral specification (EARS format requirements, edge case catalog)
- **1b**: Verification architecture (purity boundary map, proof obligations)
- **1c**: Spec review gate (adversary reviews spec; strict mode also requires human approval)

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
- Verification tool mismatch -> Phase 1b
- Missing edge cases -> Phase 1a + 2a
- Test quality issues -> Phase 2a
- Implementation bugs -> Phase 2b
- Code structure issues -> Phase 2c
- Purity boundary failures -> Phase 1b by default
- Proof gaps -> Phase 5

### Phase 5: Formal Hardening
Verification tier execution:
- Tier 0: No formal proof (tests + review only)
- Tier 1: Property tests / fuzzing / mutation
- Tier 2: Lightweight formal methods for pure-core logic
- Tier 3: Strong formal proof for safety-critical invariants
- Always produce security hardening and purity-boundary audit artifacts alongside proof results
- Required proof obligations must finish as `proved`; `skipped` is only acceptable for non-required obligations
- Formal hardening artifacts must be generated after entering Phase 5

### Phase 6: Convergence
Exit only when all convergence conditions are satisfied:
1. Specs survive adversarial review
2. Tests provide adequate coverage
3. Implementation passes all tests
4. All required proofs are proved
5. Formal hardening artifacts exist (`verification-report.md`, `security-report.md`, `purity-audit.md`)
6. `verification/security-results/` contains at least one captured execution artifact from the current Phase 5 pass
7. Every persisted `reviews/sprint-*/output/findings/FIND-NNN.json` has a matching `adversary-finding` bead
8. In strict mode, `convergenceSignals.evaluatedCriteria` exactly matches the approved contract's `CRIT-XXX` set
9. On later review iterations, `convergenceSignals.findingCount` is lower than `previousFindingCount`

## 4 Roles

| Role | Actor | Responsibility |
|------|-------|---------------|
| Architect | Human | Strategic vision, spec approval, dispute arbitration |
| Builder | LLM (sonnet) | Spec authorship, test generation, implementation |
| Adversary | LLM (opus, fresh context) | Hyper-critical review, zero tolerance |
| Verifier | LLM (sonnet) | Formal verification coordination |

## Coherence Engine (CoDD integration)

VCSDD includes a native implementation of CoDD's core mechanisms for
maintaining design coherence when requirements change:

- **CEG (Conditioned Evidence Graph)**: dependency graph between spec docs
  and declared implementation modules, stored in
  `.vcsdd/features/<name>/coherence.json`
- **Module traceability**: `modules:` frontmatter creates first-class
  `module:*` nodes linked to specs with technical edges
- **Noisy-OR confidence scoring**: evidence-based edge confidence with
  Green (≥90%) / Amber (≥50%) / Gray (<50%) band classification
- **BFS forward impact propagation**: traces all downstream tracked nodes
  when a node changes
- **DFS cycle detection**: prevents circular dependencies in the spec graph
- **Frontmatter-driven**: declare dependencies via `coherence:` blocks in
  Markdown spec files (with `source_files:` kept as file-path traceability
  metadata, not as a standalone propagation mechanism)

Coherence is **optional by activation** — it activates automatically when
spec frontmatter declares `coherence:` metadata, or when an existing
`coherence.json` is already being tracked. Features without coherence metadata
remain a no-op. Once active, the graph is enforced by the Phase 2a gate.

When coherence is active, **structural validation** (including cycle detection)
runs at the Phase **2a** gate: a failing validation **blocks** entering 2a until the
graph is fixed. Runtime errors in the coherence module also **block the Phase 2a gate**
and are logged to history. If `coherence.json` is corrupted, VCSDD preserves a
`coherence.json.bak` backup and rebuilds the graph from current frontmatter
instead of treating the cached graph as the source of truth. In the `standard`
and `strict` hook profiles, spec edits also auto-refresh the graph after each
write so later impact analysis runs against current frontmatter.

New commands:
- `/vcsdd-coherence-scan` — rebuild CEG from spec frontmatter
- `/vcsdd-coherence-impact` — run change-impact analysis
- `/vcsdd-coherence-validate` — check reference integrity and cycles

Install the coherence module:
```bash
bash install.sh --profile standard --modules vcsdd-coherence
```

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
2. Initialize: `/vcsdd-init <feature-name> --mode lean`
3. Write spec: `/vcsdd-spec`
4. Review spec: `/vcsdd-spec-review`
5. Generate tests: `/vcsdd-tdd`
6. Implement and refactor: `/vcsdd-impl`
7. Strict mode only: `/vcsdd-contract-review`
8. Review implementation: `/vcsdd-adversary`
9. Harden: `/vcsdd-harden`
10. Converge: `/vcsdd-converge`
11. Check status: `/vcsdd-status`

## Plugin Installation (Claude Code Plugin System)

Install via the Claude Code plugin system:

```bash
# Add the VCSDD marketplace
/plugin marketplace add sc30gsw/vcsdd-claude-code

# Install the plugin
/plugin install vcsdd@vcsdd-claude-code
```

After installation, skills are available as:
- `/vcsdd:init` — Initialize a feature pipeline
- `/vcsdd:spec` — Write behavioral specification
- `/vcsdd:spec-review` — Adversarial spec review
- `/vcsdd:tdd` — Generate tests (red phase)
- `/vcsdd:impl` — Implement and refactor (green + refactor)
- `/vcsdd:adversary` — Adversarial implementation review
- `/vcsdd:feedback` — Route findings to correct phase
- `/vcsdd:harden` — Formal hardening (Phase 5)
- `/vcsdd:converge` — Convergence check (Phase 6)
- `/vcsdd:escalate` — Architect escalation approval
- `/vcsdd:status` — Pipeline status
- `/vcsdd:trace` — Traceability chain
