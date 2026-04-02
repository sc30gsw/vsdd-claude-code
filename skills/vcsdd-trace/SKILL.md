---
name: vcsdd-trace
description: Display the full traceability chain for a VCSDD bead. Traverses the Chainlink graph from the given bead ID and shows all connected artifacts with status.
---

## What
Displays the full traceability chain for a given bead, traversing the Chainlink graph (BFS) to show all connected spec requirements, test cases, implementations, findings, and proof obligations.

## When
Run at any time to understand why a piece of code exists or to check spec-to-test-to-impl coverage.

## How

1. **Parse argument**: bead ID (BEAD-NNN) or external ID (REQ-001, PROP-001, etc.)
2. **If external ID**: find bead by `externalId` field
3. **Load traceability chain**: BFS traversal from root bead
4. **Display formatted chain**:
   ```
   BEAD-001 [spec-requirement] active
     External: REQ-001
     Path: specs/behavioral-spec.md#REQ-001

   Connected chain:
   +-- BEAD-003 [test-case] passing
   |     External: TEST-001
   |     Path: tests/test_parser.py::test_empty
   |     +-- BEAD-005 [implementation] implemented
   |           Path: src/parser.py:42-58
   +-- BEAD-010 [verification-property] proved
         External: PROP-001
         Path: verification/proof-harnesses/parser_empty.py
   ```
5. **Show chain completeness warnings**: orphan beads, spec reqs without tests, etc.

## Examples

```bash
/vcsdd-trace BEAD-001
/vcsdd-trace REQ-001
/vcsdd-trace PROP-002
/vcsdd-trace --check-completeness    # validate full chain integrity
```
