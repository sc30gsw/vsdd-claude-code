---
name: vcsdd-language-rust
description: Use this skill when applying VCSDD to Rust projects. Provides Kani proof harness patterns, proptest strategies, cargo-fuzz integration, and cargo-mutants mutation testing guidance.
origin: VCSDD
---

# VCSDD Language Profile: Rust

## Verification Toolset

| Tier | Tool | Install | Use Case |
|------|------|---------|---------|
| 1 | proptest | `cargo add proptest --dev` | Property-based testing |
| 1 | cargo-fuzz | `cargo install cargo-fuzz` | Coverage-guided fuzzing |
| 1 | cargo-mutants | `cargo install cargo-mutants` | Mutation testing |
| 2-3 | kani | `cargo install kani-verifier` | Bounded model checking |

## Kani Proof Harness Pattern

```rust
// In src/parser.rs or separate verification/proof-harnesses/parser.rs
#[cfg(kani)]
mod kani_proofs {
    use super::*;

    #[kani::proof]
    fn verify_empty_input_returns_error() {
        let result = parse("");
        assert_eq!(result, Err(ParseError::Empty));
    }

    #[kani::proof]
    #[kani::unwind(5)]
    fn verify_parse_never_panics() {
        let input: String = kani::any();
        kani::assume(input.len() < 20);
        // Should return Ok or Err, never panic
        let _ = parse(&input);
    }
}
```

Run: `cargo kani`

## proptest Pattern

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn test_parse_roundtrip(s in "[a-z]{1,20}") {
        if let Ok(parsed) = parse(&s) {
            assert_eq!(serialize(parsed), s);
        }
    }

    #[test]
    fn test_parse_does_not_panic(s in any::<String>()) {
        let _ = parse(&s);
    }
}
```

## cargo-fuzz Setup

```bash
cargo fuzz init
cargo fuzz add fuzz_parse
# Edit fuzz/fuzz_targets/fuzz_parse.rs:
# use libfuzzer_sys::fuzz_target;
# fuzz_target!(|data: &[u8]| {
#     if let Ok(s) = std::str::from_utf8(data) {
#         let _ = parse(s);
#     }
# });
cargo fuzz run fuzz_parse -- -max_total_time=60
```

## cargo-mutants

```bash
cargo mutants --timeout 30
# Results in mutants.out/
```
