---
name: vcsdd-language-python
description: Use this skill when applying VCSDD to Python projects. Provides hypothesis property testing patterns, mutmut mutation testing, and pytest integration for the VCSDD pipeline.
origin: VCSDD
---

# VCSDD Language Profile: Python

## Verification Toolset

| Tier | Tool | Install | Use Case |
|------|------|---------|---------|
| 1 | hypothesis | `pip install hypothesis` | Property-based testing |
| 1 | mutmut | `pip install mutmut` | Mutation testing |
| 1 | pytest-cov | `pip install pytest-cov` | Coverage reporting |

## Hypothesis Pattern

```python
from hypothesis import given, settings, strategies as st
from hypothesis import HealthCheck

@given(st.text(min_size=0, max_size=1000))
@settings(max_examples=500, suppress_health_check=[HealthCheck.too_slow])
def test_parse_never_raises_on_arbitrary_input(s: str):
    """Parse should never panic - it should return a Result."""
    try:
        result = parse(s)
        # If successful, roundtrip should hold
        if result is not None:
            assert serialize(result) == s
    except ParseError:
        pass  # Expected error types are ok

@given(st.from_regex(r'[a-z]{1,20}'))
def test_parse_valid_input(s: str):
    result = parse(s)
    assert result is not None
    assert serialize(result) == s
```

## mutmut Setup

```bash
# Run mutation testing
mutmut run --paths-to-mutate src/

# Check results
mutmut results
mutmut show <mutation_id>  # See specific mutations

# Generate HTML report
mutmut html
```

## Red Phase Evidence

```bash
# Run tests and capture output
pytest tests/ -v 2>&1 | tee .vcsdd/features/<name>/evidence/sprint-1-red-phase.log
# Verify failure
grep -q "FAILED" .vcsdd/features/<name>/evidence/sprint-1-red-phase.log
```
