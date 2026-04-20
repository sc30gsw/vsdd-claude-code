---
name: vcsdd-init
description: "Initialize a VCSDD feature pipeline with directory tree, mode selection (strict or lean), and optional language target. Use when starting a new feature, beginning a VCSDD workflow, or setting up the project structure before running vcsdd-spec or vcsdd-tdd."
---

## How

1. **Parse arguments**: `FEATURE_NAME [--mode strict|lean] [--language rust|python|typescript|go|cpp]`
2. **Validate feature name**: must be kebab-case (a-z0-9 and hyphens only)
3. **Create directory structure**:
   ```
   .vcsdd/
     index.json (created/updated)
     history.jsonl (created if missing)
     features/
       FEATURE_NAME/
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
   initFeature('user-auth', 'lean', undefined);
   ```
5. **Verify initialization**: confirm `state.json` contains `currentPhase: "init"` and `.vcsdd/index.json` lists the new feature as active
6. **Display confirmation**: feature name, mode, language (if any), next step (`/vcsdd-spec`)

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
