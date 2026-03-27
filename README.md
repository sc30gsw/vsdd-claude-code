# vsdd-claude-code

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-orange)

**Languages**: [日本語](docs/ja-JP/README.md)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)

A Claude Code plugin that brings **Verified Spec-Driven Development (VSDD)** methodology to any project. It enforces spec-first, test-first, adversarial review, and formal verification as sequential quality gates.

---

## What is VSDD?

AI-assisted development has a structural problem: there are no quality gates. Language models produce code that passes surface-level review but routinely harbors spec mismatches, untested edge cases, and structural debt. This is "AI slop" -- code that looks correct but conceals hidden deficiencies.

VSDD is a methodology that fuses three disciplines into a single workflow:

- **Spec-Driven Development (SDD)** -- behavior is fully specified before any code is written
- **Test-Driven Development (TDD)** -- failing tests are written before any implementation
- **Verification-Driven Development (VDD)** -- formal verification is treated as a first-class deliverable, not an afterthought

These are joined by an **adversarial review gate**: a fresh-context agent running on a more capable model that reviews all artifacts with zero tolerance and produces binary verdicts. The adversary is structurally isolated from the builder -- it reads only from disk and cannot be influenced by the builder's conversational context.

The result is a systematic process for eliminating the gap between "looks correct" and "is correct."

---

## Key Features

**6-phase pipeline**
Spec Crystallization -> Test-First Implementation -> Adversarial Review -> Feedback Integration -> Formal Hardening -> Convergence. Each phase has explicit prerequisites and produces file artifacts that serve as the handoff to the next phase.

**Two operating modes**
- `strict` -- full VSDD ceremony for high-assurance work: sprint contracts, multiple adversary passes, proof obligations, all 6 phases enforced
- `lean` -- streamlined planner/builder/evaluator flow for product work: fewer gates, optional formal verification, faster iteration

**Fresh-context adversary agent**
The adversary (`vsdd-adversary`) runs on the Opus model and is always spawned as a new agent instance with zero conversational history from the builder. It reads review artifacts from disk, produces findings, and terminates. It cannot say "overall looks good" -- it must cite concrete evidence for every verdict.

**Binary PASS/FAIL verdicts across 5 dimensions**
1. Spec Fidelity
2. Edge Case Coverage
3. Implementation Correctness
4. Structural Integrity
5. Verification Readiness

**Chainlink bead traceability system**
Every requirement, test, implementation block, adversary finding, and formal proof is assigned a bead identifier and linked in a directed graph. Any line of code can be traced back to its originating requirement. The full chain is preserved in an append-only `history.jsonl` audit log.

**Gate enforcement via Claude Code hooks**
The `vsdd-gate-check.js` hook runs on `PreToolUse` for `Write`/`Edit`/`MultiEdit` and for `Bash` when the command targets phase-restricted paths. It blocks direct writes, shell redirects, in-place edits, and common path-based mutation commands such as `cp` into restricted areas. Gate strictness is controlled by the `VSDD_HOOK_PROFILE` environment variable.

**Language verification profiles**
- **Rust** -- Kani (formal verification), proptest (property testing), cargo-fuzz / AFL++ (fuzzing), cargo-mutants (mutation testing)
- **Python** -- hypothesis (property testing), python-afl (fuzzing), mutmut (mutation testing)
- **TypeScript** -- fast-check (property testing), jsfuzz (fuzzing), Stryker (mutation testing)
- **Go** -- rapid (property testing), go-fuzz (fuzzing), go-mutesting (mutation testing)
- **C/C++** -- CBMC (formal verification), AFL++ / libFuzzer (fuzzing), mull (mutation testing)

**Git integration with phase-tagged commits**
The `/vsdd-commit` command generates conventional commit messages that include phase identifiers, bead traceability summaries, and artifact manifests. Optional auto-commit (disabled by default) only stages files that belong to the active feature and current phase, and creates `vsdd/<feature>/phase-<id>` tags without overwriting existing tags.

---

## Architecture

### 4 Agents

| Agent | Model | Access | Role |
|---|---|---|---|
| `vsdd-orchestrator` | sonnet | Read, Write, Glob, Grep, Bash | Pipeline coordinator and gate enforcer. Never skips gate checks. |
| `vsdd-builder` | sonnet | Read, Write, Edit, Bash, Glob, Grep | Spec author and TDD implementer. Phase-aware file writing only. |
| `vsdd-adversary` | **opus** | Read, Write, Edit, Grep, Glob | Adversarial reviewer. Fresh context; writes only `reviews/**/output/` (verdict + findings). |
| `vsdd-verifier` | sonnet | Read, Write, Edit, Bash, Grep, Glob | Formal verification coordinator. Language-profile aware. |

Agents communicate exclusively through files under `.vsdd/features/<feature-name>/`. There is no shared conversational context between the builder and the adversary.

### 12 Slash Commands

| Command | Phase | Purpose |
|---|---|---|
| `/vsdd-init` | -- | Initialize a feature pipeline |
| `/vsdd-spec` | 1a + 1b | Write behavioral spec and verification architecture |
| `/vsdd-spec-review` | 1c | Spec review gate (adversary + human approval) |
| `/vsdd-tdd` | 2a | Generate failing tests (Red phase) |
| `/vsdd-impl` | 2b + 2c | Implement to pass tests (Green) then refactor |
| `/vsdd-adversary` | 3 | Run adversarial review with fresh-context agent |
| `/vsdd-feedback` | 4 | Route adversary findings to the correct phase |
| `/vsdd-harden` | 5 | Execute formal verification tier |
| `/vsdd-converge` | 6 | Check four-dimensional convergence |
| `/vsdd-status` | -- | Display current pipeline state |
| `/vsdd-trace` | -- | Display full traceability chain for a bead |
| `/vsdd-commit` | -- | Commit with phase tag and bead summary |

### 13 Skills

Core workflow skills: `vsdd-spec-crystallization`, `vsdd-sprint-contracts`, `vsdd-adversarial-refinement`, `vsdd-grading-criteria`, `vsdd-feedback-routing`, `vsdd-convergence-detection`, `vsdd-formal-hardening`, `vsdd-verification-architecture`, `vsdd-traceability`, `vsdd-git-integration`

Language verification skills: `vsdd-language-rust`, `vsdd-language-python`, `vsdd-language-typescript`

### 6 JSON Schemas

| Schema | Validates |
|---|---|
| `vsdd-state.schema.json` | Pipeline state including proof obligations |
| `vsdd-index.schema.json` | Feature index (`.vsdd/index.json`) |
| `vsdd-contract.schema.json` | Sprint contract format |
| `vsdd-grading.schema.json` | Grading criteria |
| `vsdd-finding.schema.json` | Adversary finding format |
| `vsdd-bead.schema.json` | Traceability bead |

### Runtime State Layout

```
.vsdd/
  index.json                      # Known features and active pointers
  active-feature.txt              # Mirror of index.json.activeFeature for tool compatibility
  history.jsonl                   # Global append-only audit log
  features/
    <feature-name>/
      state.json                  # Pipeline state (source of truth)
      specs/
        behavioral-spec.md        # Phase 1a output
        verification-architecture.md  # Phase 1b output
      contracts/
        sprint-{N}.md             # Work contract
        sprint-{N}-review.md      # Adversary feedback on contract
      reviews/
        spec/
          iteration-{N}/
            input/manifest.json   # Spec review manifest (Phase 1c)
            output/verdict.json
        sprint-{N}/
          input/manifest.json     # Orchestrator writes before review
          output/verdict.json     # Adversary writes after review
      evidence/
        sprint-{N}-red-phase.log  # Contains new-feature-tests: FAIL and regression-baseline: PASS
        sprint-{N}-green-phase.log # Contains target-feature-tests: PASS and regression-baseline: PASS
        sprint-{N}-coverage.json
      verification/
        proof-harnesses/
        fuzz-results/
        mutation-results/
        verification-report.md
      escalations/
        escalation-{timestamp}.md
```

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/sc30gsw/vsdd-claude-code.git
cd vsdd-claude-code

# Install the plugin (standard profile)
bash install.sh --profile standard

# Optional: add a language profile
bash install.sh --profile standard --language typescript
```

Alternative package-manager entrypoints also work:

```bash
npx vsdd-claude-code --profile standard
pnpm dlx vsdd-claude-code --profile standard
yarn dlx vsdd-claude-code --profile standard
bunx vsdd-claude-code --profile standard
npx vsdd-claude-code --profile standard --dry-run
```

```
# Open a project in Claude Code, then:

# Initialize a feature pipeline in lean mode
/vsdd-init user-auth --mode lean

# Phase 1a + 1b: Write behavioral spec and verification architecture
/vsdd-spec

# Phase 1c: Adversary reviews the spec; human approves
/vsdd-spec-review

# Phase 2a: Generate failing tests (Red phase)
/vsdd-tdd
# Transitioning to 2a starts sprint 1 for this implementation cycle

# Phase 2b + 2c: Implement to green, then refactor
/vsdd-impl

# Phase 3: Adversarial review -- fresh opus agent, binary verdict
/vsdd-adversary

# Phase 4: Route findings back to affected phases (if FAIL)
/vsdd-feedback

# Phase 5: Run formal verification (optional in lean mode)
/vsdd-harden

# Phase 6: Check four-dimensional convergence
/vsdd-converge

# Check pipeline state at any point
/vsdd-status

# Display traceability chain for a bead
/vsdd-trace REQ-001

# Commit with phase tag and artifact manifest
/vsdd-commit
```

---

## Pipeline State Machine

```
init
  |
  v
1a  Behavioral spec (EARS format requirements, edge case catalog)
  |
  v
1b  Verification architecture (purity boundary map, proof obligations)
  |
  v
1c  Spec review gate (adversary reviews spec, human approves)
  |
  v
2a  Test generation -- Red phase (new tests must fail)
  |
  v
2b  Implementation -- Green phase (make tests pass)
  |
  v
2c  Refactor (maintain green, improve structure)
  |
  v
 3  Adversarial review (fresh context, binary PASS/FAIL)
  |
  +-- FAIL --> 4  Feedback routing
  |                |
  |                +--> spec ambiguity     --> 1a
  |                +--> missing edge cases --> 1a + 2a
  |                +--> test quality       --> 2a
  |                +--> implementation bug --> 2b
  |                +--> code structure     --> 2c
  |                +--> proof gap          --> 5
  |
  v (PASS)
 5  Formal hardening (Tier 0-3 verification)
  |
  v
 6  Convergence check (specs + tests + implementation + required proofs)
  |
  v
complete
```

Gate prerequisites:

| Phase | Required Before Entry |
|---|---|
| 1b | `behavioral-spec.md` exists |
| 1c | `verification-architecture.md` exists |
| 2a | Lean: spec review PASS or SKIP. Strict: adversary PASS plus explicit human approval |
| 2b | Red phase evidence exists, was recorded after entering 2a, and proves both `new-feature-tests: FAIL` and `regression-baseline: PASS` |
| 2c | Green phase evidence exists, was recorded after entering 2b, and proves both `target-feature-tests: PASS` and `regression-baseline: PASS` |
| 3 | Tests pass post-refactor, with green evidence recorded after the latest implementation/refactor phase and carrying both target/regression PASS markers |
| 5 | Adversary verdict PASS |
| 6 | Verification report exists and all required proof obligations pass |

Evidence logs use explicit top-of-file markers so hooks can distinguish "new tests failed" from "baseline still green" and "target tests passed" from "regression suite passed".

---

## Operating Modes

| Capability | strict | lean |
|---|---|---|
| Sprint contracts | Required per sprint | Required for risky work only |
| Adversary review rounds | Multiple | Single |
| Proof obligations | Enforced | Optional |
| Phases traversed | All 6 | 1 -> 2 -> 3 -> 6 (abbreviated) |
| Gate enforcement hook profile | strict | standard |
| Iteration limit (adversary) | 5 | 3 |
| Human escalation threshold | Hit iteration limit | Hit iteration limit |
| Suitable for | Safety-critical, financial, security | Product work, prototypes, internal tooling |

Select mode at initialization:

```
/vsdd-init <feature-name> --mode strict
/vsdd-init <feature-name> --mode lean
```

---

## Installation

### Install Profiles

```bash
# Minimal: rules, commands, and core runtime libraries only
bash install.sh --profile minimal

# Standard: full workflow with agents and skills (recommended)
bash install.sh --profile standard

# Strict: same hook bundle as standard; set VSDD_HOOK_PROFILE=strict for the strict hook map (e.g. auto-commit hook enabled)
bash install.sh --profile strict
```

Alternative package-manager entrypoint:

```bash
npx vsdd-claude-code --profile standard
```

### Language Profiles

```bash
bash install.sh --profile standard --language rust
bash install.sh --profile standard --language python
bash install.sh --profile standard --language typescript
bash install.sh --profile standard --language go
bash install.sh --profile standard --language cpp
```

Language profiles configure the verifier agent with the correct toolset. Rust/Python/TypeScript also install dedicated language skills; Go/C++ use the manifest-backed tool profile without an extra skill bundle.

### Profile Contents

| Component | minimal | standard | strict |
|---|---|---|---|
| Rules | yes | yes | yes |
| Commands | yes | yes | yes |
| Agents | no | yes | yes |
| Skills | no | yes | yes |
| Contexts | no | yes | yes |
| Hooks | no | yes | yes |
| Core runtime scripts (`scripts/lib/`) | yes | yes | yes |
| Hook scripts (`scripts/hooks/`) | no | yes | yes |

---

## VSDD 8 Principles

1. **Spec Supremacy** -- The behavioral specification is the highest authority below the human developer. All code must answer to the spec, never the reverse.

2. **Verification-First Architecture** -- Formal provability shapes the system design. Code structure is chosen to make properties provable, not to make them easier to write.

3. **Red Before Green** -- No implementation code is written until a failing test demands it. The red phase is a hard gate, not a convention.

4. **Anti-Slop Bias** -- The first version that appears correct is assumed to contain hidden debt. Surface plausibility is not evidence of correctness.

5. **Forced Negativity** -- The adversary must find problems. Politeness filters are disabled by design. "Looks good overall" is not a valid finding.

6. **Linear Accountability** -- Every spec requirement, test case, and line of implementation is tracked to a named artifact. Nothing exists without a reason on record.

7. **Entropy Resistance** -- Adversarial context is reset on every review pass. The adversary cannot be primed by the builder's reasoning, even inadvertently.

8. **Four-Dimensional Convergence** -- The pipeline is complete only when specs survive adversarial review, tests provide adequate coverage, implementation passes all tests, and all required proofs pass. All four conditions must hold simultaneously.

---

## Traceability Chain

The Chainlink bead system gives every artifact a unique identifier and links it to related artifacts across phases. At any point you can ask "why does this line of code exist?" and receive a complete answer.

**Example chain for a single requirement:**

```
REQ-001  "When input is empty, the parser returns an empty AST node"
  |       (behavioral-spec.md, Phase 1a)
  |
  +--> PROP-001  "forall empty input, parse(input).node_count == 0"
  |              (verification-architecture.md, Phase 1b)
  |
  +--> TEST-001  "test_parse_empty_input() -> asserts node_count == 0"
  |              (tests/parser_test.rs, Phase 2a)
  |
  +--> IMPL-001  "fn parse(input: &str) -> AstNode { ... }"
  |              (src/parser.rs:42-58, Phase 2b)
  |
  +--> FIND-001  "IMPL-001 does not handle null bytes before empty check"
  |              (reviews/sprint-1/output/verdict.json, Phase 3)
  |
  +--> PROOF-001  "kani::proof fn verify_empty_input() { ... }"
                 (verification/proof-harnesses/parser_empty.rs, Phase 5)
```

Every state change to a bead is appended to `.vsdd/history.jsonl`, providing a complete audit trail from first requirement to final proof.

---

## Hook Profiles

The `VSDD_HOOK_PROFILE` environment variable controls which hooks are active. Hooks are defined in `hooks/hooks.json` and loaded automatically by Claude Code v2.1+ plugin convention.
These semantics apply when the hook bundle is installed. The `minimal` install profile does not install hooks.

| Hook | Event | minimal | standard | strict |
|---|---|---|---|---|
| Gate enforcement | PreToolUse (Write/Edit/Bash heuristics) | OFF | ON | ON |
| Session persistence | SessionStart | ON | ON | ON |
| State persist on exit | Stop | ON | ON | ON |
| Pre-compact checkpoint | PreCompact | OFF | ON | ON |
| Auto-commit on phase completion | PostToolUse (Bash) | OFF | OFF | ON |

Auto-commit requires an explicit opt-in even in strict mode:

```bash
export VSDD_AUTO_COMMIT=true
```

Without this flag, auto-commit is a no-op regardless of the hook profile. The manual `/vsdd-commit` command is the default path.
Even with the flag enabled, auto-commit skips when dirty files fall outside the active feature's current phase scope.

---

## Reference

- **VSDD Methodology** (original specification): https://gist.github.com/dollspace-gay/d8d3bc3ecf4188df049d7a4726bb2a00
- **Anthropic Harness Design** (planner/generator/evaluator architecture): https://www.anthropic.com/engineering/harness-design-long-running-apps
- **everything-claude-code** (ECC plugin patterns): https://github.com/affaan-m/everything-claude-code

---

## License

MIT. See `package.json`.
