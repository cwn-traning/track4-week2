---
paths:
  - "src/**/*.tsx"
  - "app/**/*.tsx"
---
# 04 — React and Next.js Component Style

## Mandatory
- Prefer named function declarations for reusable components and named exports. Use default exports for required Next.js entry points (`page.tsx`, `layout.tsx`, etc.).
- Define Props interfaces explicitly; use `ReactNode` for `children` and semantic HTML types when extending native element props.
- Prefer server components by default in App Router. Place `'use client'` only at a minimal interactive boundary, not in parent pages by habit.
- Do not use React hooks, event handlers, or browser APIs inside a Server Component.
- Never put secrets or server-only APIs inside a Client Component's dependency graph.
- Do not introduce `React.FC` for new components; use function declarations with explicit props.
- Keep JSX readable; use separate named handlers for non-trivial event logic.
- Render lists with stable keys (not array indices for reorderable data).
- Keep MUI styling aligned to existing theme tokens (`sx` where suitable); do not invent raw colors/spacing values when tokens exist.
- Do not apply memoization reflexively; measure or identify a real correctness/performance need.

## DO — Server page + small Client component
`src/app/users/page.tsx`
```tsx
import { UserSearch } from '@/features/users/components/UserSearch';

export default function UsersPage() {
  return <UserSearch />;
}
```

`src/features/users/components/UserSearch.tsx`
```tsx
'use client';

import { useState } from 'react';
import { Button, Stack, TextField } from '@mui/material';

export function UserSearch() {
  const [query, setQuery] = useState('');

  function handleClear() {
    setQuery('');
  }

  return (
    <Stack direction="row" spacing={2}>
      <TextField
        label="Search users"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Button onClick={handleClear}>Clear</Button>
    </Stack>
  );
}
```

## DON'T — client boundary on every page
```tsx
'use client';
import { useState } from 'react';

export default function UsersPage() {
  const [query, setQuery] = useState('');
  return <div onClick={() => setQuery('x')}>{query}</div>;
}
```
This is not inherently invalid; it is discouraged when the page can remain server-rendered and interactivity can be isolated in a child component.
