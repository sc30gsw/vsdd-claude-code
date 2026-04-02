---
name: vcsdd-git-integration
description: Use this skill when committing VCSDD pipeline artifacts to git. Provides conventional commit message format, phase tag patterns, and atomic staging strategies.
origin: VCSDD
---

# VCSDD Git Integration

## When to Activate
- Running /vcsdd-commit command
- Creating phase-completion commits
- Tagging pipeline milestones

## Commit Message Format

```
vcsdd(<phase>): <feature-name> - <phase-description>

Phase: <phase-id>
Feature: <feature-name>
Sprint: <N>
Gate: <PASS|FAIL|SKIP>
Beads: <bead-ids-affected>
Iteration: <N>

Artifacts:
- specs/behavioral-spec.md [modified]
- evidence/sprint-1-red-phase.log [added]

Traceability:
- REQ-001 -> TEST-001 -> IMPL-001 [green]
- REQ-002 -> TEST-002 [red, pending implementation]
```

## Git Tag Format

```
vcsdd/<feature>/phase-1a    # Spec crystallization complete
vcsdd/<feature>/phase-1c    # Spec gate passed
vcsdd/<feature>/phase-2a    # Red phase complete
vcsdd/<feature>/phase-2b    # Green phase complete
vcsdd/<feature>/phase-3-i1  # Adversary review iteration 1
vcsdd/<feature>/phase-6     # Convergence achieved
```

## Atomic Staging

Stage all VCSDD artifacts atomically:
```bash
git add -- .vcsdd/index.json .vcsdd/history.jsonl .vcsdd/active-feature.txt .vcsdd/features/<name>/ [phase-scoped source/test/spec files]
git commit -m "vcsdd(2b): my-feature - implementation (green phase)"
git tag vcsdd/my-feature/phase-2b
```

Only stage files that belong to the active feature and current phase. If unrelated dirty files exist, stop and require a manual review instead of widening the stage set.

## Auto-Commit Safety Rules

Auto-commit (VCSDD_AUTO_COMMIT=true) refuses to commit if:
- Unrelated dirty files exist in worktree
- Phase transition is invalid
- No phase change detected since last commit
