# VSDD Agent Orchestration

## Agent Overview

| Agent | Model | Tools | Role | Key Constraint |
|-------|-------|-------|------|----------------|
| vsdd-orchestrator | sonnet | Read,Write,Glob,Grep,Bash | Pipeline coordinator, gate enforcer | Never skip gate checks |
| vsdd-builder | sonnet | Read,Write,Edit,Bash,Glob,Grep | Spec author, TDD implementer | Phase-aware file writing only |
| vsdd-adversary | **opus** | Read,Write,Edit,Grep,Glob | Adversarial reviewer | Writes **only** `reviews/**/output/`; fresh context per review |
| vsdd-verifier | sonnet | Read,Write,Edit,Bash,Grep,Glob | Verification coordinator | Writes `verification/**` + updates obligations in `state.json` |

## When to Use Each Agent

### vsdd-orchestrator
- `/vsdd-init`, `/vsdd-status`, `/vsdd-converge`, `/vsdd-feedback`, `/vsdd-contract-review` commands
- Phase transitions and gate recording
- Writing review manifests for adversary
- Routing adversary findings to correct phases
- Managing escalation records

### vsdd-builder
- `/vsdd-spec`, `/vsdd-tdd`, `/vsdd-impl`, `/vsdd-commit` commands
- Writing behavioral specifications (EARS format)
- Writing verification architectures
- Generating failing tests (Red phase)
- Implementing code to pass tests (Green phase)
- Refactoring (Phase 2c)

### vsdd-adversary
- `/vsdd-adversary`, `/vsdd-spec-review`, `/vsdd-contract-review` commands
- **ALWAYS spawned as a FRESH agent instance** (new conversation, zero Builder context)
- Reviews from disk only - reads review manifest and artifacts
- Writes `verdict.json` and `findings/*.json` under the review output directory only
- Produces binary PASS/FAIL verdicts with concrete evidence

### vsdd-verifier
- `/vsdd-harden` command
- Runs language-appropriate verification tools
- Writes proof harnesses
- Produces verification reports

## Core Orchestration Principles

1. **Linear Accountability**: Every agent action produces a file artifact or state transition
2. **Entropy Resistance**: vsdd-adversary MUST be spawned fresh - never reuse Builder context
3. **File-Based Handoffs**: Agents communicate via `.vsdd/features/<name>/` directories, not conversation
4. **Gate Enforcement**: vsdd-orchestrator validates prerequisites before every phase transition

## Adversary Spawn Protocol

When spawning vsdd-adversary, the orchestrator:
1. Writes manifest to one of:
   - `reviews/spec/iteration-{N}/input/manifest.json`
   - `reviews/contracts/sprint-{N}/input/manifest.json`
   - `reviews/sprint-{N}/input/manifest.json`
2. Creates matching `output/findings/`
3. Spawns NEW vsdd-adversary agent (not the current agent)
4. Waits for verdict.json to appear
5. Reads and processes verdict

This is the ONLY way to run adversarial review. Never have the Builder self-review.

## State Machine Coordination

```
Orchestrator controls phase transitions:
init -> 1a -> 1b -> 1c -> 2a -> 2b -> 2c -> 3 -> 4 -> [1a|2a|2b|2c|5] -> 5 -> 6 -> complete
                                                                               ↑
                                                                         convergence loop (max 2)
```

All transitions validated with `getAllowedTransitions(state)` / `validateTransition(state, target)` in `scripts/lib/vsdd-state.js` (mode-aware: strict vs lean).
