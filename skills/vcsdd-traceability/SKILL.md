---
name: vcsdd-traceability
description: Use this skill when creating or querying VCSDD Chainlink bead traceability. Provides bead creation patterns, chain traversal, and completeness validation.
origin: VCSDD
---

# VCSDD Traceability (Chainlink Beads)

## When to Activate
- Creating new artifacts (specs, tests, code, findings)
- Running /vcsdd-trace command
- Validating chain completeness before Phase 6

## Bead Types and Creation Points

| Type | Created In Phase | ID Prefix | Status Lifecycle |
|------|-----------------|-----------|-----------------|
| spec-requirement | 1a | REQ-XXX | draft -> active -> superseded |
| verification-property | 1b | PROP-XXX | draft -> active -> proved/failed |
| test-case | 2a | TEST-XXX | draft -> red -> green -> passing/failing |
| implementation | 2b | IMPL-XXX | draft -> implemented |
| adversary-finding | 3 | FIND-XXX | open -> resolved |
| contract-criterion | 2a | CRIT-XXX | draft -> active -> resolved |

## Traceability Chain

```
REQ-001 (spec-requirement)
  -> PROP-001 (verification-property)
  -> TEST-001 (test-case)
  -> IMPL-001 (implementation)
  -> FIND-001 (adversary-finding, if issue found)
```

## Creating Beads

```javascript
const { createBead, linkBeads } = require('./scripts/lib/vcsdd-traceability');

// Create spec requirement bead
const req = createBead('my-feature', {
  type: 'spec-requirement',
  artifactPath: 'specs/behavioral-spec.md#REQ-001',
  status: 'active',
  externalId: 'REQ-001',
  createdInPhase: '1a',
});

// Create test case and link it
const test = createBead('my-feature', {
  type: 'test-case',
  artifactPath: 'tests/test_parser.py::test_empty_input',
  status: 'red',
  externalId: 'TEST-001',
  linkedBeads: [req.beadId], // automatically creates bidirectional link
});
```

## Chain Display (/vcsdd-trace)

```
BEAD-001 [spec-requirement] active
  Path: specs/behavioral-spec.md#REQ-001
  Links: BEAD-003, BEAD-010
  +-- BEAD-003 [test-case] passing
  |     Path: tests/test_parser.py::test_empty_input
  |     Links: BEAD-001, BEAD-005
  |     +-- BEAD-005 [implementation] implemented
  |           Path: src/parser.py:42-58
  +-- BEAD-010 [verification-property] proved
        Path: verification/proof-harnesses/parser_empty.py
```
