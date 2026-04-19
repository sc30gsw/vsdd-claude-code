---
name: vcsdd-spec
description: "Run Phase 1a (behavioral specification) and Phase 1b (verification architecture) for the active VCSDD feature. Writes EARS-format requirements and purity boundary analysis. Use when writing specs, generating requirements, or setting up verification architecture after vcsdd-init."
---

## How

1. **Check active feature and phase**:
   ```javascript
   const { loadState } = require(path.join(pluginRoot, 'scripts/lib/vcsdd-state.js'));
   const state = loadState(featureName);
   // state.currentPhase must be 'init', '1a', or '1b'
   ```
2. **Invoke vcsdd-builder agent** for Phase 1a:
   - Write `specs/behavioral-spec.md` with EARS requirements (REQ-001, REQ-002, ...)
   - Cover all functional requirements, edge cases, and non-functional constraints
   - Identify purity boundary candidates
3. **Transition to 1a**:
   ```javascript
   const { transitionPhase } = require(path.join(pluginRoot, 'scripts/lib/vcsdd-state.js'));
   transitionPhase(featureName, '1a');
   ```
4. **Run Phase 1b** (both strict and lean modes):
   - Write `specs/verification-architecture.md`
   - Define proof obligations (PROP-XXX) per requirement
   - Assign verification tiers (0-3)
   - Map purity boundary explicitly
5. **Transition to 1b**: `transitionPhase(featureName, '1b')`
6. **Verify**: confirm both spec files exist and contain at least one REQ-XXX and PROP-XXX entry
7. **Create traceability beads** for each REQ-XXX and PROP-XXX

In lean mode, fewer `required: true` proof obligations are recorded and strict-mode human approval at the spec gate is not required.

## Examples

```bash
/vcsdd-spec
```
