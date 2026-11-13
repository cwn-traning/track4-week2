---
paths:
  - "src/**/*.{ts,tsx}"
  - "app/**/*.{ts,tsx}"
---
# 03 — TypeScript Standards

## Mandatory
- Enable/retain strict TypeScript project settings; do not loosen them for convenience.
- Avoid `any`, `@ts-ignore`, broad `as` assertions, and non-null assertions. Prefer `unknown` + narrowing at untrusted boundaries.
- Use `interface` for component props and extensible object contracts; use `type` for unions, intersections, tuples, mapped and utility types.
- Type exported functions' parameters and return values, particularly domain/service boundaries. Inference is fine for obvious local expressions.
- Model finite states with string literal unions or discriminated unions, not arbitrary strings or boolean combinations.
- Avoid `enum` for new simple string-valued states; prefer literal unions unless the repository has an established enum convention.
- Use `import type` for type-only imports when supported by the repo configuration.
- Never force API responses into trusted domain types without validation or deliberate boundary mapping.

## DO — typed statuses and exhaustive handling
```ts
type RequestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; userName: string }
  | { status: 'error'; message: string };

export function getRequestLabel(state: RequestState): string {
  switch (state.status) {
    case 'idle': return 'Ready';
    case 'loading': return 'Loading';
    case 'success': return state.userName;
    case 'error': return state.message;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}
```

## DON'T
```ts
function getRequestLabel(state: any) {
  return state.userName || state.error || 'Ready';
}

const user = response.data as User; // unchecked network data
```

## Boundary example
```ts
export function isUserSummary(value: unknown): value is { id: string; name: string } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.name === 'string';
}
```

Use an established schema validator in the repo for complex boundary validation rather than repeating manual guards.
