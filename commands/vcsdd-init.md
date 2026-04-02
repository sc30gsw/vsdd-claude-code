---
description: Initialize a VCSDD feature pipeline. Creates the .vcsdd/features/<name>/ directory tree, sets mode (strict|lean), and activates the feature. Must be run before any other VCSDD command.
---

## What
Initializes a new VCSDD feature pipeline for the specified feature name. Creates all required directories and state files, sets the operating mode (strict or lean), and marks the feature as active.

## When
Run at the start of every new feature development cycle. Must be run before `/vcsdd-spec`, `/vcsdd-tdd`, or any other VCSDD command.

## How

1. **Parse arguments**: `<feature-name> [--mode strict|lean] [--language rust|python|typescript|go|cpp]`
2. **Validate feature name**: must be kebab-case (a-z0-9 and hyphens only)
3. **Create directory structure**:
   ```
   .vcsdd/
     index.json (created/updated)
     history.jsonl (created if missing)
     features/
       <feature-name>/
         state.json
         specs/
         contracts/
         reviews/
         evidence/
         verification/proof-harnesses/
         verification/fuzz-results/
         verification/mutation-results/
         verification/security-results/
         escalations/
   ```
4. **Initialize via state library** (do not hand-author `state.json`):
   ```javascript
   const path = require('path');
   const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(process.env.HOME, '.claude', 'plugins', 'vcsdd-claude-code');
   const { initFeature } = require(path.join(pluginRoot, 'scripts/lib/vcsdd-state.js'));
   // language: optional string rust|python|typescript|go|cpp
   initFeature('<feature-name>', '<strict|lean>', languageOrUndefined);
   ```
   This writes `state.json` with `currentPhase: "init"`, mode, optional `language` field, empty traceability/gates/proofObligations, and updates `.vcsdd/index.json` (including `language` on the feature entry when provided).
5. **Append to history.jsonl**: `{event: "feature_created", ...}` (done by `initFeature`)
6. **Display confirmation**: feature name, mode, language (if any), next action

## Examples

```bash
/vcsdd-init user-auth --mode lean
/vcsdd-init payment-service --mode strict --language rust
/vcsdd-init search-feature
```

## Mode Selection Guide

| Use `lean` when | Use `strict` when |
|-----------------|-------------------|
| Prototyping / product work | Safety-critical code |
| Small, low-risk features | Financial/security features |
| Time-constrained work | High-assurance requirements |
| Learning the VCSDD workflow | Production deployment gates |

Lean mode still traverses all 6 phases. It relaxes approval and contract requirements, but it does not skip Phase 1b, Phase 2c, or Phase 5.
