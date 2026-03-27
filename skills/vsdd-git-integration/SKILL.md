---
name: vsdd-git-integration
description: Use this skill when committing VSDD pipeline artifacts to git. Provides conventional commit message format, phase tag patterns, and atomic staging strategies.
origin: VSDD
---

# VSDD Git Integration

## When to Activate
- Running /vsdd-commit command
- Creating phase-completion commits
- Tagging pipeline milestones

## Commit Message Format

```
vsdd(<phase>): <feature-name> - <phase-description>

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
vsdd/<feature>/phase-1a    # Spec crystallization complete
vsdd/<feature>/phase-1c    # Spec gate passed
vsdd/<feature>/phase-2a    # Red phase complete
vsdd/<feature>/phase-2b    # Green phase complete
vsdd/<feature>/phase-3-i1  # Adversary review iteration 1
vsdd/<feature>/phase-6     # Convergence achieved
```

## Atomic Staging

Stage all VSDD artifacts atomically:
```bash
git add src/ tests/ .vsdd/features/<name>/ evidence/
git commit -m "vsdd(2b): my-feature - implementation (green phase)"
git tag vsdd/my-feature/phase-2b
```

## Auto-Commit Safety Rules

Auto-commit (VSDD_AUTO_COMMIT=true) refuses to commit if:
- Unrelated dirty files exist in worktree
- Phase transition is invalid
- No phase change detected since last commit
