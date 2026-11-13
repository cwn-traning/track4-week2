---
paths:
  - "src/**/*.{ts,tsx,js,jsx}"
  - "app/**/*.{ts,tsx,js,jsx}"
---
# 01 — Code Style

## Mandatory
- Write clear, small functions with one reason to change. Extract only when a boundary or reuse is real.
- Use early returns to reduce nesting.
- Prefer `const`; use `let` only when reassignment is required; never use `var`.
- Prefer `===` / `!==` and nullish coalescing (`??`) when `0`, `false`, or `''` are valid values.
- Avoid unnecessary non-null assertions (`!`), magic numbers and boolean positional parameters.
- Prefer explicit, meaningful names over one-letter abbreviations (except local indices).
- Do not hand-format against the existing Prettier configuration; run the formatter if available.
- Import ordering must follow the repo's configured linter/formatter. Avoid adding a competing ordering convention.
- Comments must explain intent, constraints, or non-obvious behavior, not narrate simple code.

## DO
```ts
const DEFAULT_PAGE_SIZE = 20;

export function getDisplayName(firstName: string, lastName?: string): string {
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  return fullName || 'Unknown';
}

export function getPageSize(requestedSize?: number): number {
  return requestedSize ?? DEFAULT_PAGE_SIZE;
}
```

## DON'T
```ts
var size = 20;
export const name = (a: any, b: any) => {
  if (a) {
    if (b) {
      return a + ' ' + b;
    }
  }
  return 'Unknown';
};
const pageSize = requestedSize || 20; // discards valid zero
```

## Exceptions
- Keep third-party/API field names unchanged in boundary DTOs (e.g. `created_at`), then map to internal naming.
- Do not rewrite existing formatting unless the task targets it.
