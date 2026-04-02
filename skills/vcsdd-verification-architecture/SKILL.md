---
name: vcsdd-verification-architecture
description: Use this skill when writing Phase 1b verification architecture documents. Provides purity boundary mapping, proof obligation design, and tier assignment guidance.
origin: VCSDD
---

# VCSDD Verification Architecture

## When to Activate
- Phase 1b (verification architecture)
- Designing proof obligations for a feature
- Reviewing purity boundaries

## Purity Boundary Design

### Identifying the Pure Core

A function belongs in the pure core if:
- Same input ALWAYS produces same output (no randomness, no time, no state)
- No I/O operations (no file reads, network calls, DB queries)
- No mutations to shared state
- Can be tested without mocks

### Identifying the Effectful Shell

A function belongs in the effectful shell if:
- It reads from external sources (files, DB, APIs)
- It writes to external sinks
- It uses system time or randomness
- It coordinates side effects

### Architecture Pattern

```
+---------------------------------+
|         Effectful Shell         |
|  (HTTP handlers, DB adapters)   |
|                                 |
|    +---------------------+      |
|    |     Pure Core       |      |
|    |  (business rules,   |      |
|    |   parsing, calcs)   |      |
|    +---------------------+      |
+---------------------------------+
```

## Proof Obligation Design

Each proof obligation should specify:
- What property is being proved
- Which verification tier is appropriate
- Whether it is required for Phase 6 convergence

Good proof obligations:
- `PROP-001`: Parse(Serialize(x)) == x (round-trip property)
- `PROP-002`: Validate(x) == false implies Transform(x) raises an error
- `PROP-003`: Token budget never goes negative

Poor proof obligations (too vague):
- `PROP-004`: Code is correct
- `PROP-005`: No errors occur
