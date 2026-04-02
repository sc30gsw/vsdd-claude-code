---
name: vcsdd-escalate
description: Architect escalation approval — extend iteration limit for a phase that has hit its cap. Records the approval decision in state and allows the blocked transition to proceed.
---

## What
Approves an escalation when an iteration limit has been exceeded, allowing the pipeline to continue beyond its default cap. This command represents the Architect's explicit decision to grant an exception.

## When
Run after `transitionPhase` throws an "Iteration limit exceeded" error. Check `escalations/` directory for the escalation file to review before approving.

## How

1. **Read active feature state.json**
2. **Check escalations/ directory** for pending escalation files
3. **Display the escalation details** (phase, iteration, limit, reason)
4. **Confirm with the user** (in strict mode: require explicit "approve" response)
5. **Update state.json**:
   - Set `state.iterations[phase]` to `limit - 1` (so the next `transitionPhase` call will be at exactly the limit)
   - Append to `state.phaseHistory`: `{ from: currentPhase, to: currentPhase, timestamp: ..., reason: "Architect escalation approved: <reason>", escalationApproved: true }`
6. **Mark the escalation file as resolved** by appending `\n## Resolution\n\nApproved by Architect at <timestamp>. Iteration counter reset to allow one more attempt.\n` to the file
7. **Report** which phase was unblocked and what the new iteration counter is

## Arguments

- `--phase <phase>` — specify which phase to approve (required if multiple escalations pending)
- `--reason <text>` — brief justification for the exception (optional, defaults to "Architect approved continuation")

## Examples

```bash
/vcsdd-escalate
/vcsdd-escalate --phase 3
/vcsdd-escalate --phase 3 --reason "All prior findings were minor structural issues; core logic is correct"
```
