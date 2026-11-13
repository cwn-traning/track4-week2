---
paths:
  - "src/**/*.{ts,tsx}"
  - "app/**/*.{ts,tsx}"
---
# 02 — Naming Conventions

## Naming matrix
| Item | Convention | Example |
|---|---|---|
| React component name/file | PascalCase | `UserProfile.tsx` |
| Component props interface | PascalCase + Props | `UserProfileProps` |
| Hook name/file | use + PascalCase | `useUserProfile.ts` |
| Variables/functions | camelCase | `fetchUserProfile` |
| Boolean flags | `is`, `has`, `can`, `should` prefix | `isSubmitting` |
| Event callbacks | `handle` in component; `on` for callback prop | `handleSave`, `onSave` |
| Interfaces/types | PascalCase | `UserSummary` |
| Union types | PascalCase | `UserStatus` |
| Global immutable constants | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Feature directories | kebab-case | `user-management/` |
| Utility files | kebab-case | `format-date.ts` |
| Service files | kebab-case + `.service.ts` | `user.service.ts` |
| Schemas | kebab-case + `.schema.ts` | `user.schema.ts` |
| Type files | kebab-case + `.types.ts` | `user.types.ts` |
| Tests | same stem + `.test.ts(x)` | `UserProfile.test.tsx` |
| Next.js special files | framework convention | `page.tsx`, `layout.tsx`, `loading.tsx` |
| URL segments | lowercase kebab-case | `/user-management` |

## DO
```tsx
interface UserProfileProps {
  displayName: string;
  isActive: boolean;
  onEdit: () => void;
}

export function UserProfile({ displayName, isActive, onEdit }: UserProfileProps) {
  function handleEdit() {
    if (!isActive) return;
    onEdit();
  }

  return <button onClick={handleEdit}>{displayName}</button>;
}
```

## DON'T
```tsx
interface props { User_Name: string; active: boolean; cb: () => void }
export const user_profile = ({ User_Name, active, cb }: props) => (
  <button onClick={cb}>{User_Name}</button>
);
```

## Consistency note
- Preserve names required by framework integrations, generated code, external APIs, and existing public contracts.
- Avoid renaming unrelated files solely to satisfy these rules.
