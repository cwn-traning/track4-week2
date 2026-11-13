---
paths:
  - "src/app/**"
  - "src/features/**"
  - "src/components/**"
  - "app/**"
---
# 05 — Feature-Based Architecture

## Target structure
```text
src/
├── app/
│   └── users/
│       └── page.tsx
├── features/
│   └── users/
│       ├── components/
│       │   ├── UserList.tsx
│       │   └── UserSearch.tsx
│       ├── hooks/
│       │   └── useUsers.ts
│       ├── services/
│       │   └── user.service.ts
│       ├── schemas/
│       │   └── user.schema.ts
│       ├── types/
│       │   └── user.types.ts
│       └── utils/
│           └── map-user.ts
├── components/ui/
├── hooks/
├── lib/
└── utils/
```
Directories are examples, not an obligation to create every empty layer.

## Ownership
- `src/app/`: routing, layouts, metadata, and route composition. Keep page-specific glue here; avoid deep business logic.
- `src/features/<feature>/`: UI, hooks, services, schemas, types, and pure utilities owned by that feature.
- `src/components/ui/`: genuinely shared, business-agnostic presentation components.
- `src/lib/`: shared infrastructure and approved integrations.
- `src/hooks/`, `src/utils/`, `src/types/`: genuinely cross-feature facilities.
- Feature modules must not deep-import private implementation details from other features. If cross-feature reuse is real, expose a deliberate public entry point or promote the shared abstraction after review.
- Keep server-only code segregated from client imports; consider `server-only` enforcement for server modules when available.
- Create only files needed by the task. Avoid speculative folders, generic base services, and unnecessary barrel exports.

## DO
```tsx
// src/app/users/page.tsx
import { UserList } from '@/features/users/components/UserList';

export default function UsersPage() {
  return <UserList />;
}
```

```ts
// src/features/users/types/user.types.ts
export interface UserSummary {
  id: string;
  displayName: string;
}
```

## DON'T
```tsx
// src/app/users/page.tsx
// Avoid placing fetching, validation, transforms, and hundreds of lines
// of user-specific UI business logic inside the route entry file.
```

## Migration safeguard
If the current repo is organized differently, follow the existing structure for an isolated bug fix; propose architecture changes separately rather than performing a surprise migration.
