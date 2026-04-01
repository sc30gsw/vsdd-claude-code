# vcsdd-claude-code

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-orange)

**Languages**: [日本語](docs/ja-JP/README.md)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)

A Claude Code plugin that brings **Verified Spec-Driven Development (VCSDD)** methodology to any project. It enforces spec-first, test-first, adversarial review, and formal verification as sequential quality gates.

---

## What is VCSDD?

AI-assisted development has a structural problem: there are no quality gates. Language models produce code that passes surface-level review but routinely harbors spec mismatches, untested edge cases, and structural debt. This is "AI slop" -- code that looks correct but conceals hidden deficiencies.

VCSDD is a methodology that fuses four disciplines into a single workflow:

- **Spec-Driven Development (SDD)** -- behavior is fully specified before any code is written
- **Test-Driven Development (TDD)** -- failing tests are written before any implementation
- **Verification-Driven Development (VDD)** -- formal verification is treated as a first-class deliverable, not an afterthought
- **Coherence-Driven Development (CoDD)** -- dependency relationships between spec documents are tracked so that requirement changes propagate automatically to all affected artifacts

These are joined by an **adversarial review gate**: a fresh-context agent running on a more capable model that reviews all artifacts with zero tolerance and produces binary verdicts. The adversary is structurally isolated from the builder -- it reads only from disk and cannot be influenced by the builder's conversational context.

The result is a systematic process for eliminating the gap between "looks correct" and "is correct."

---

## Key Features

**6-phase pipeline**
Spec Crystallization -> Test-First Implementation -> Adversarial Review -> Feedback Integration -> Formal Hardening -> Convergence. Each phase has explicit prerequisites and produces file artifacts that serve as the handoff to the next phase.

**Two operating modes**
- `strict` -- full VCSDD ceremony for high-assurance work: sprint contracts, multiple adversary passes, proof obligations, all 6 phases enforced
- `lean` -- all 6 phases remain in place, but approvals, sprint contracts, and proof obligations are lighter for product work and faster iteration

These modes are plugin-specific extensions, not a claim that canonical VCSDD defines two ceremonies. Canonical VCSDD assumes the human Architect signs off on the Phase 1c spec gate; this plugin keeps that as a hard requirement in `strict` mode and relaxes it in `lean` mode for faster product iteration.

**Fresh-context adversary agent**
The adversary (`vcsdd-adversary`) runs on the Opus model and is always spawned as a new agent instance with zero conversational history from the builder. It reads review artifacts from disk, produces findings, and terminates. It cannot say "overall looks good" -- it must cite concrete evidence for every verdict.

**Binary PASS/FAIL verdicts across 5 operational dimensions**
1. Spec Fidelity
2. Edge Case Coverage
3. Implementation Correctness
4. Structural Integrity
5. Verification Readiness

These are stable machine-readable buckets for the plugin, not a claim that the original article names these exact five dimensions. In methodology terms they compress the broader Phase 3 concerns: spec fidelity, test quality including edge cases, code quality, security surface, and spec gaps / verification readiness.

**Chainlink bead traceability system**
Every requirement, test, implementation block, adversary finding, and formal proof is assigned a bead identifier and linked in a directed graph. Any line of code can be traced back to its originating requirement. The full chain is preserved in an append-only `history.jsonl` audit log.
Completion is blocked if any persisted adversary finding lacks a matching `adversary-finding` bead.

**Gate enforcement via Claude Code hooks**
The `vcsdd-gate-check.js` hook runs on `PreToolUse` for `Write`/`Edit`/`MultiEdit` and for `Bash` when the command targets phase-restricted paths. It blocks direct writes, shell redirects, in-place edits, and common path-based mutation commands such as `cp` into restricted areas. Gate strictness is controlled by the `VCSDD_HOOK_PROFILE` environment variable.

**Coherence Engine (CoDD integration)**
When requirements change mid-project, the Coherence Engine traces which downstream spec documents are affected and classifies them into confidence bands before any code is touched. It is implemented natively in Node.js inside `scripts/lib/vcsdd-coherence.js` and stores its graph in `.vcsdd/features/<name>/coherence.json`.
- **CEG (Conditioned Evidence Graph)** -- directed dependency graph between spec documents; built from `coherence:` frontmatter blocks in Markdown files
- **Noisy-OR confidence scoring** -- evidence-based edge weights aggregated into Green (≥90%) / Amber (≥50%) / Gray (<50%) impact bands
- **BFS forward impact propagation** -- traces all downstream nodes when a spec changes, so no affected document is silently missed
- **DFS cycle detection** -- prevents circular dependencies in the spec graph before they corrupt propagation
- **Opt-in and non-blocking** -- activates only when `coherence.json` is present; completely a no-op when absent, preserving all existing VCSDD guarantees

**Language verification profiles**
- **Rust** -- `proptest`, `cargo-fuzz`, `cargo-mutants`, with `kani` as the bundled Tier 2 verifier and `cbmc` as a Tier 3 fallback hint
- **Python** -- `hypothesis` and `mutmut`
- **TypeScript** -- `fast-check` and `@stryker-mutator/core`
- **Go** -- `rapid` and `go-fuzz`
- **C/C++** -- `libFuzzer` and `CBMC`

**Git integration with phase-tagged commits**
The `/vcsdd-commit` command generates conventional commit messages that include phase identifiers, bead traceability summaries, and artifact manifests. Optional auto-commit (disabled by default) only stages files that belong to the active feature and current phase, and creates `vcsdd/<feature>/phase-<id>` tags without overwriting existing tags.

---

## Architecture

### Methodology Roles vs Runtime Agents

Canonical VCSDD defines four roles: Human Architect, Builder, Tracker (Chainlink), and Adversary. This plugin maps those roles onto runtime components as follows: the human Architect remains outside the plugin, the Tracker is implemented as the bead graph plus `history.jsonl`, and the plugin adds `vcsdd-orchestrator` and `vcsdd-verifier` as execution aids for pipeline coordination and Phase 5 hardening.

### 4 Runtime Agents

| Agent | Model | Access | Role |
|---|---|---|---|
| `vcsdd-orchestrator` | sonnet | Read, Write, Glob, Grep, Bash | Pipeline coordinator and gate enforcer. Never skips gate checks. |
| `vcsdd-builder` | sonnet | Read, Write, Edit, Bash, Glob, Grep | Spec author and TDD implementer. Phase-aware file writing only. |
| `vcsdd-adversary` | **opus** | Read, Write, Edit, Grep, Glob | Adversarial reviewer. Fresh context; writes only `reviews/**/output/` (verdict + findings). |
| `vcsdd-verifier` | sonnet | Read, Write, Edit, Bash, Grep, Glob | Formal verification coordinator. Language-profile aware. |

Agents communicate exclusively through files under `.vcsdd/features/<feature-name>/`. There is no shared conversational context between the builder and the adversary.

### 16 Slash Commands

| Command | Phase | Purpose |
|---|---|---|
| `/vcsdd-init` | -- | Initialize a feature pipeline |
| `/vcsdd-spec` | 1a + 1b | Write behavioral spec and verification architecture |
| `/vcsdd-spec-review` | 1c | Spec review gate (canonical VCSDD expects adversary + human review; this plugin makes human approval mandatory in strict mode and optional in lean mode) |
| `/vcsdd-tdd` | 2a | Generate failing tests (Red phase) |
| `/vcsdd-impl` | 2b + 2c | Implement to pass tests (Green) then refactor |
| `/vcsdd-contract-review` | 2c | Strict-mode sprint contract review before adversarial implementation review |
| `/vcsdd-adversary` | 3 | Run adversarial review with fresh-context agent |
| `/vcsdd-feedback` | 4 | Route adversary findings to the correct phase |
| `/vcsdd-harden` | 5 | Execute formal verification tier |
| `/vcsdd-converge` | 6 | Check four-dimensional convergence |
| `/vcsdd-status` | -- | Display current pipeline state |
| `/vcsdd-trace` | -- | Display full traceability chain for a bead |
| `/vcsdd-commit` | -- | Commit with phase tag and bead summary |
| `/vcsdd-coherence-scan` | -- | Rebuild CEG from spec frontmatter |
| `/vcsdd-coherence-impact` | -- | Run BFS change-impact analysis from changed spec nodes |
| `/vcsdd-coherence-validate` | -- | Validate CEG reference integrity and detect cycles |

### 16 Skills

Core workflow skills: `vcsdd-spec-crystallization`, `vcsdd-sprint-contracts`, `vcsdd-adversarial-refinement`, `vcsdd-grading-criteria`, `vcsdd-feedback-routing`, `vcsdd-convergence-detection`, `vcsdd-formal-hardening`, `vcsdd-verification-architecture`, `vcsdd-traceability`, `vcsdd-git-integration`

Language verification skills: `vcsdd-language-rust`, `vcsdd-language-python`, `vcsdd-language-typescript`

Coherence skills: `vcsdd-coherence-scan`, `vcsdd-coherence-impact`, `vcsdd-coherence-validate`

### 7 JSON Schemas

| Schema | Validates |
|---|---|
| `vcsdd-state.schema.json` | Pipeline state including proof obligations |
| `vcsdd-index.schema.json` | Feature index (`.vcsdd/index.json`) |
| `vcsdd-contract.schema.json` | Sprint contract format |
| `vcsdd-grading.schema.json` | Grading criteria |
| `vcsdd-finding.schema.json` | Adversary finding format |
| `vcsdd-bead.schema.json` | Traceability bead |
| `vcsdd-coherence.schema.json` | Coherence graph (CEG nodes, edges, evidence) |

### Runtime State Layout

```
.vcsdd/
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
      reviews/
        spec/
          iteration-{N}/
            input/manifest.json   # Spec review manifest (Phase 1c)
            output/
              findings/FIND-NNN.json
              verdict.json
        contracts/
          sprint-{N}/
            input/manifest.json   # Strict-mode contract review manifest
            output/
              findings/FIND-NNN.json
              verdict.json
        sprint-{N}/
          input/manifest.json     # Orchestrator writes before review
          output/
            findings/FIND-NNN.json
            verdict.json          # Adversary writes after review
      evidence/
        sprint-{N}-red-phase.log  # Contains new-feature-tests: FAIL and regression-baseline: PASS
        sprint-{N}-green-phase.log # Contains target-feature-tests: PASS and regression-baseline: PASS
        sprint-{N}-coverage.json
      verification/
        proof-harnesses/
        fuzz-results/
        mutation-results/
        security-results/       # Raw security-tool output; must contain at least one artifact
        verification-report.md
        security-report.md
        purity-audit.md
      escalations/
        escalation-{timestamp}.md
      coherence.json                  # CEG (optional; coherence engine is no-op when absent)
```

---

## Quick Start

### Step 1: Install the Plugin

**Option 1: Claude Code Plugin System (Recommended)**

```bash
# Register as a marketplace source (once)
/plugin marketplace add sc30gsw/vcsdd-claude-code

# Install the plugin
/plugin install vcsdd@sc30gsw-vcsdd-claude-code
```

Skills are available as `/vcsdd:init`, `/vcsdd:spec`, `/vcsdd:adversary`, etc.

**Option 2: Install Script**

```bash
git clone https://github.com/sc30gsw/vcsdd-claude-code.git
cd vcsdd-claude-code
bash install.sh --profile standard

# Optional: add a language profile
bash install.sh --profile standard --language typescript
```

**Option 3: Package Manager**

```bash
npx vcsdd-claude-code --profile standard
pnpm dlx vcsdd-claude-code --profile standard
```

**Restart Claude Code** (or reload the window) after install. Confirm with `/vcsdd-status` (install script) or `/vcsdd:status` (plugin system).

```
# Open a project in Claude Code, then:

# Initialize a feature pipeline in lean mode
/vcsdd-init user-auth --mode lean

# Phase 1a + 1b: Write behavioral spec and verification architecture
/vcsdd-spec

# Phase 1c: Canonical VCSDD expects adversary review plus human sign-off.
# This plugin enforces that in strict mode and leaves it optional in lean mode.
/vcsdd-spec-review

# Phase 2a: Generate failing tests (Red phase)
/vcsdd-tdd
# Transitioning to 2a starts sprint 1 for this implementation cycle

# Phase 2b + 2c: Implement to green, then refactor
/vcsdd-impl
# Recommended canonical checkpoint: human reviews tests + implementation for spirit-of-spec alignment before Phase 3

# Strict mode only: adversary reviews the sprint contract before phase 3
/vcsdd-contract-review
# After PASS, changing anything except `status:` requires rerunning contract review

# Phase 3: Adversarial review -- fresh opus agent, binary verdict
/vcsdd-adversary

# Phase 4: Route findings back to affected phases (if FAIL)
/vcsdd-feedback

# Phase 5: Run formal hardening
# Even in lean mode, this writes verification-report.md, security-report.md, and purity-audit.md.
# If there are zero required proof obligations, the proof report is lightweight, but security/purity artifacts are still required.
/vcsdd-harden

# Phase 6: Check four-dimensional convergence
/vcsdd-converge

# Check pipeline state at any point
/vcsdd-status

# Display traceability chain for a bead
/vcsdd-trace REQ-001

# Commit with phase tag and artifact manifest
/vcsdd-commit

# --- Optional: Coherence Engine (CoDD) ---
# Rebuild the CEG from coherence: frontmatter in spec files
/vcsdd-coherence-scan

# Run change-impact analysis (classify downstream specs into Green/Amber/Gray)
/vcsdd-coherence-impact [node_id]

# Validate CEG reference integrity and detect circular dependencies
/vcsdd-coherence-validate
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
1c  Spec review gate (canonical VCSDD expects adversary review + human sign-off; strict enforces this, lean relaxes it)
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
  |                +--> verification tool  --> 1b
  |                +--> missing edge cases --> 1a + 2a
  |                +--> test quality       --> 2a
  |                +--> implementation bug --> 2b
  |                +--> code structure     --> 2c
  |                +--> purity boundary    --> 1b
  |                +--> proof gap          --> 5
  |
  v (PASS)
 5  Formal hardening (proofs + security hardening + purity audit)
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
| 1c | `behavioral-spec.md` and `verification-architecture.md` exist |
| 2a | Spec review PASS. Canonical VCSDD expects explicit human approval at Phase 1c; this plugin enforces that in strict mode and treats it as a lean-mode relaxation |
| 2b | Red phase evidence exists, was recorded after entering 2a, and proves both `new-feature-tests: FAIL` and `regression-baseline: PASS` |
| 2c | Green phase evidence exists, was recorded after entering 2b, and proves both `target-feature-tests: PASS` and `regression-baseline: PASS` |
| 3 | Tests pass post-refactor, with green evidence recorded after the latest implementation/refactor phase and carrying both target/regression PASS markers. Strict mode also requires `contracts/sprint-{N}.md` with `status: approved`, at least one `CRIT-XXX`, and `reviews/contracts/sprint-{N}/output/verdict.json` with `overallVerdict: PASS`, matching `reviewContext.contractPath`, matching `reviewContext.contractDigest`, and `iteration = negotiationRound + 1` |
| 5 | Adversary verdict PASS, or an explicit Phase 4 feedback route whose current sprint findings all route to Phase 5 |
| 6 | `verification-report.md`, `security-report.md`, and `purity-audit.md` exist with the required sections and were recorded after entering Phase 5, `verification/security-results/` contains at least one captured output artifact recorded after entering Phase 5, all required proof obligations are `proved` (not `skipped`), and every persisted adversary finding under `reviews/sprint-*/output/findings/` has a matching `adversary-finding` bead. Strict mode also requires `convergenceSignals.allCriteriaEvaluated = true` plus an exact `convergenceSignals.evaluatedCriteria` match against the approved contract's `CRIT-XXX` set |

For review iterations beyond the first, convergence also requires `convergenceSignals.findingCount < convergenceSignals.previousFindingCount` before completion.

Evidence logs use explicit top-of-file markers so hooks can distinguish "new tests failed" from "baseline still green" and "target tests passed" from "regression suite passed".
Feedback routing is explicit in runtime state: the orchestrator records `3 -> 4 -> target` rather than jumping directly out of Phase 3.
Runtime also rejects feedback routing that skips an earlier `routeToPhase` from the current sprint's findings.

---

## Operating Modes

| Capability | strict | lean |
|---|---|---|
| Sprint contracts | Required per sprint | Required for risky work only |
| Sprint contract review | Required before Phase 3; verdict is bound to the approved contract snapshot | Optional when a sprint contract exists |
| Adversary review rounds | Multiple (up to 5 Phase 3 iterations) | Reduced (up to 3 Phase 3 iterations) |
| Human approval at spec gate | Required; matches canonical VCSDD | Optional plugin relaxation; canonical VCSDD still expects human sign-off |
| Proof obligations | Required obligations are enforced | Selective; often zero are marked required |
| Formal hardening artifacts | `verification-report.md`, `security-report.md`, `purity-audit.md` | `verification-report.md`, `security-report.md`, `purity-audit.md` |
| Phases traversed | All 6 | All 6 |
| Iteration limit (adversary) | 5 | 3 |
| Human escalation threshold | Hit iteration limit | Hit iteration limit |
| Suitable for | Safety-critical, financial, security | Product work, prototypes, internal tooling |

Select mode at initialization:

```
/vcsdd-init <feature-name> --mode strict
/vcsdd-init <feature-name> --mode lean
```

`--mode`, install profile, and `VCSDD_HOOK_PROFILE` are separate knobs. A feature started in `--mode strict` does not automatically switch the hook profile to `strict`, and `install.sh --profile strict` does not rewrite `.vcsdd/.../state.json`.

---

## Installation

This is a Claude Code plugin. Installing it copies agents, commands, skills, hooks, and runtime scripts into `~/.claude/plugins/vcsdd-claude-code/`, where Claude Code discovers them automatically on next launch.

### Option 1: Claude Code Plugin System (Recommended)

Claude Code のプラグインシステムを使って直接インストールできます。

```bash
# マーケットプレイスとして登録（初回のみ）
/plugin marketplace add sc30gsw/vcsdd-claude-code

# プラグインをインストール
/plugin install vcsdd@sc30gsw-vcsdd-claude-code
```

インストール後、以下のスキルが利用可能になります。

| スキル | 説明 |
|--------|------|
| `/vcsdd:init` | フィーチャーパイプラインを初期化 |
| `/vcsdd:spec` | 行動仕様を作成（Phase 1a/1b） |
| `/vcsdd:spec-review` | 仕様のAdversary Reviewを実行（Phase 1c） |
| `/vcsdd:tdd` | テストを生成（Phase 2a: Red Phase） |
| `/vcsdd:impl` | 実装とリファクタリング（Phase 2b/2c） |
| `/vcsdd:adversary` | 実装のAdversary Reviewを実行（Phase 3） |
| `/vcsdd:feedback` | Findingsを適切なフェーズにルーティング（Phase 4） |
| `/vcsdd:harden` | Formal Hardening（Phase 5） |
| `/vcsdd:converge` | Convergence検証（Phase 6） |
| `/vcsdd:escalate` | Architectエスカレーション承認 |
| `/vcsdd:status` | パイプラインステータスを表示 |
| `/vcsdd:trace` | トレーサビリティチェーンを確認 |

> **Note:** Plugin System経由でインストールした場合、コマンドは `/vcsdd:init` のようにコロン区切りの名前空間付きで呼び出します。

### Option 2: Install Script

```bash
git clone https://github.com/sc30gsw/vcsdd-claude-code.git
cd vcsdd-claude-code
bash install.sh --profile standard
```

### Option 2: Package Manager

```bash
npx vcsdd-claude-code --profile standard
pnpm dlx vcsdd-claude-code --profile standard
bunx vcsdd-claude-code --profile standard
```

After installation, **restart Claude Code** (or reload the window) so the new agents, commands, and skills are picked up.

### Verify Installation

Once Claude Code reloads, confirm the plugin is active:

```
/vcsdd-status
```

If the command is recognized, installation was successful.

### Install Profiles

```bash
# Minimal: docs, manifests, schemas, rules, commands, and core runtime libraries
bash install.sh --profile minimal

# Standard: full workflow with contexts, agents, skills, and hooks (recommended)
bash install.sh --profile standard

# Strict: installs the same file set as standard for high-assurance workflows;
# pair it with /vcsdd-init --mode strict and VCSDD_HOOK_PROFILE=strict when you want strict runtime behavior
bash install.sh --profile strict
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

The canonical runtime tool hints live in `manifests/language-profiles.json`; this README mirrors only the currently bundled hints.

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

## VCSDD 8 Principles

1. **Spec Supremacy** -- The behavioral specification is the highest authority below the human developer. All code must answer to the spec, never the reverse.

2. **Verification-First Architecture** -- Formal provability shapes the system design. Code structure is chosen to make properties provable, not to make them easier to write.

3. **Red Before Green** -- No implementation code is written until a failing test demands it. The red phase is a hard gate, not a convention.

4. **Anti-Slop Bias** -- The first version that appears correct is assumed to contain hidden debt. Surface plausibility is not evidence of correctness.

5. **Forced Negativity** -- The adversary must find problems. Politeness filters are disabled by design. "Looks good overall" is not a valid finding.

6. **Linear Accountability** -- Every spec requirement, test case, and line of implementation is tracked to a named artifact. Nothing exists without a reason on record.

7. **Entropy Resistance** -- Adversarial context is reset on every review pass. The adversary cannot be primed by the builder's reasoning, even inadvertently.

8. **Four-Dimensional Convergence** -- The pipeline is complete only when specs survive adversarial review, tests provide adequate coverage, implementation passes all tests, and all required proofs are proved. All four conditions must hold simultaneously.

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

Every state change to a bead is appended to `.vcsdd/history.jsonl`, providing a complete audit trail from first requirement to final proof.

---

## Hook Profiles

The `VCSDD_HOOK_PROFILE` environment variable controls which hooks are active. Hooks are defined in `hooks/hooks.json` and loaded automatically by Claude Code v2.1+ plugin convention.
These semantics apply when the hook bundle is installed. The `minimal` install profile does not install hooks.

| Hook | Event | minimal | standard | strict |
|---|---|---|---|---|
| Gate enforcement | PreToolUse (Write/Edit/Bash heuristics) | OFF | ON | ON |
| Session persistence | SessionStart | ON | ON | ON |
| State persist on exit | Stop | ON | ON | ON |
| Pre-compact checkpoint | PreCompact | OFF | ON | ON |
| Auto-commit on phase completion | PostToolUse (Bash) | OFF | OFF | ON |

Hook profile activation is orthogonal to feature mode. Use `VCSDD_HOOK_PROFILE=minimal` when you want session lifecycle hooks without gate enforcement.

Auto-commit requires an explicit opt-in even in strict mode:

```bash
export VCSDD_AUTO_COMMIT=true
```

Without this flag, auto-commit is a no-op regardless of the hook profile. The manual `/vcsdd-commit` command is the default path.
Even with the flag enabled, auto-commit skips when dirty files fall outside the active feature's current phase scope.

---

## Reference

- **VCSDD Methodology** (original specification): https://gist.github.com/dollspace-gay/d8d3bc3ecf4188df049d7a4726bb2a00
- **Anthropic Harness Design** (planner/generator/evaluator architecture): https://www.anthropic.com/engineering/harness-design-long-running-apps
- **everything-claude-code** (ECC plugin patterns): https://github.com/affaan-m/everything-claude-code
- **CoDD (Coherence-Driven Development)**: https://github.com/yohey-w/codd-dev
- **CoDD — Coherence Engine解説** (Zenn article, Japanese): https://zenn.dev/shio_shoppaize/articles/shogun-codd-coherence

---

## License

MIT. See `package.json`.
