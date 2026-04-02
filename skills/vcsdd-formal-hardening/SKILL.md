---
name: vcsdd-formal-hardening
description: Use this skill during Phase 5 formal hardening. Provides tool selection, proof harness patterns, security/purity audit expectations, and verification result interpretation for Rust (Kani), Python (hypothesis), and TypeScript (fast-check).
origin: VCSDD
---

# VCSDD Formal Hardening

## When to Activate
- Phase 5 (formal hardening)
- Writing verification harnesses
- Interpreting property test failures

## Tool Selection by Tier

| Tier | Rust | Python | TypeScript |
|------|------|--------|------------|
| 1 | proptest, cargo-fuzz | hypothesis | fast-check |
| 2 | kani | (manual invariants) | (manual invariants) |
| 3 | kani + CBMC | (escalate to human) | (escalate to human) |

## Proof Harness Patterns

### Rust - Kani (Tier 2)
```rust
#[cfg(kani)]
mod verification {
    use super::*;

    #[kani::proof]
    fn verify_parse_empty() {
        let result = parse("");
        assert!(result == Err(ParseError::Empty));
    }

    #[kani::proof]
    #[kani::unwind(10)]
    fn verify_parse_roundtrip() {
        let input: String = kani::any();
        kani::assume(input.len() < 10);
        if let Ok(parsed) = parse(&input) {
            assert_eq!(serialize(parsed), input);
        }
    }
}
```

### Python - Hypothesis (Tier 1)
```python
from hypothesis import given, strategies as st

@given(st.text(min_size=0, max_size=100))
def test_parse_arbitrary(s):
    result = parse(s)
    if result.is_ok():
        assert serialize(result.value) == s
```

### TypeScript - fast-check (Tier 1)
```typescript
import * as fc from 'fast-check';

test('parse roundtrip', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 0, maxLength: 100 }), (s) => {
      const result = parse(s);
      if (result.ok) {
        return serialize(result.value) === s;
      }
      return true; // error cases are valid
    })
  );
});
```

## Graceful Degradation

Always produce:
1. `verification-report.md`
2. `security-report.md`
3. `purity-audit.md`
4. At least one captured file under `verification/security-results/`

If required tool is unavailable:
1. Document the degradation in `verification-report.md`
2. Degrade to lower tier
3. Only leave an obligation as `skipped` when it is **not required**
4. Still run security hardening / purity audit and write their artifacts
5. Required obligations that remain `skipped` block Phase 6
6. Pipeline DOES NOT block if obligation is not required
