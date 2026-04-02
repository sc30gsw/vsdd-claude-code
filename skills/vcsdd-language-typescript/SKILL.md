---
name: vcsdd-language-typescript
description: Use this skill when applying VCSDD to TypeScript/JavaScript projects. Provides fast-check property testing patterns, Stryker mutation testing, and vitest/jest integration for the VCSDD pipeline.
origin: VCSDD
---

# VCSDD Language Profile: TypeScript

## Verification Toolset

| Tier | Tool | Install | Use Case |
|------|------|---------|---------|
| 1 | fast-check | `npm install -D fast-check` | Property-based testing |
| 1 | @stryker-mutator/core | `npm install -D @stryker-mutator/core` | Mutation testing |
| 1 | vitest / jest | `npm install -D vitest` | Unit + property tests |

## fast-check Pattern

```typescript
import * as fc from 'fast-check';
import { describe, it } from 'vitest';
import { parse, serialize } from '../src/parser';

describe('parser properties', () => {
  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        // Should return Ok or Err, never throw
        const result = parse(s);
        return result !== undefined;
      })
    );
  });

  it('roundtrip: parse(serialize(x)) === x', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), (s) => {
        const result = parse(s);
        if (result.ok) {
          return serialize(result.value) === s;
        }
        return true; // Error cases are valid
      }),
      { numRuns: 1000 }
    );
  });
});
```

## Stryker Setup

```bash
# Initialize Stryker
npx stryker init

# Run mutation testing
npx stryker run

# Check results in reports/mutation/
```

stryker.config.js:
```javascript
module.exports = {
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  testRunner: 'vitest',
  reporters: ['html', 'clear-text', 'progress'],
  thresholds: { high: 80, low: 60, break: 50 },
};
```

## Type-Safe Result Pattern

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

function parse(input: string): Result<ParsedDoc, ParseError> {
  if (!input) return { ok: false, error: ParseError.Empty };
  // ...
}
```

Using discriminated unions ensures the compiler enforces error handling.
