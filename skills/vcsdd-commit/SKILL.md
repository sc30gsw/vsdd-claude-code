---
name: vcsdd-commit
description: Create a git commit for the current VCSDD phase. Auto-generates a conventional commit message from state.json including phase, sprint, gate verdict, and affected bead IDs. Tags with vcsdd/<feature>/phase-<id>.
---

## What
Creates a git commit atomically staging source, tests, `.vcsdd/features/<name>/`, and evidence files. Auto-generates a conventional commit message from pipeline state.

## When
Run at any phase completion milestone to preserve the pipeline state in git. Works at any phase.

## How

1. **Read state.json**: get feature name, phase, sprint, gate verdict, affected beads
2. **Check for unrelated dirty files**: warn if worktree has changes outside scope
3. **Build commit message**:
   ```
   vcsdd(2b): my-feature - implementation (green phase)

   Phase: 2b
   Feature: my-feature
   Sprint: 1
   Gate: PASS
   Beads: BEAD-005, BEAD-006, BEAD-007
   Iteration: 1

   Artifacts:
   - src/parser.py [added]
   - tests/test_parser.py [modified]
   - .vcsdd/features/my-feature/evidence/sprint-1-green-phase.log [added]

   Traceability:
   - REQ-001 -> TEST-001 -> IMPL-001 [green]
   ```
4. **Stage atomically**:
   ```bash
   git add -- .vcsdd/index.json .vcsdd/history.jsonl .vcsdd/active-feature.txt .vcsdd/features/my-feature/ [phase-scoped source/test/spec files]
   ```
   Limit staging to files that belong to the active feature and current phase. If other dirty files exist, stop and ask for a manual commit instead of widening the scope.
5. **Commit** with generated message
6. **Create phase tag**: `git tag vcsdd/my-feature/phase-2b` (do not overwrite an existing tag)
7. **Record last-commit-phase** for auto-commit deduplication

## Auto-Commit vs Manual

This command is for **manual** phase commits. The `vcsdd-auto-commit.js` hook handles auto-commits (only when `VCSDD_AUTO_COMMIT=true` and worktree is clean).

## Examples

```bash
/vcsdd-commit
/vcsdd-commit --message "custom note"    # append custom note to auto-generated message
/vcsdd-commit --tag-only                 # tag without new commit (already committed manually)
```
