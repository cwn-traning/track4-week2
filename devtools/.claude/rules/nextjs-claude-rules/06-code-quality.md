---
paths:
  - "src/**/*.{ts,tsx}"
  - "app/**/*.{ts,tsx}"
  - "tests/**/*.{ts,tsx}"
---
# 06 — Code Quality and Review Checklist

## Rules
- Avoid unrelated edits or bulk formatting.
- Preserve runtime behavior during style-only changes.
- Handle `null`, `undefined`, empty lists, and expected error states where applicable.
- Preserve accessibility: labels for inputs, semantic elements, keyboard-accessible controls.
- Never log tokens, credentials, or sensitive user data.
- Do not hide failures with empty `catch` blocks or generic success fallbacks.
- Never change package versions or add dependencies without approval.
- Verify that `use client` boundaries do not accidentally import server-only code.
- Do not leave unused imports, unreachable code, or debugging statements.

## DO
```ts
export function formatUserLabel(name: string | null | undefined): string {
  const value = name?.trim();
  return value ? value : 'Unknown user';
}
```

## DON'T
```ts
export function formatUserLabel(name: any) {
  try {
    return name.trim();
  } catch (_) {
    return 'OK'; // misleading fallback
  }
}
```

## Pre-delivery checklist
- [ ] Inspected existing conventions in neighboring files.
- [ ] Naming and file locations match feature ownership.
- [ ] No newly introduced `any`, suppression comments, or unsafe assertions.
- [ ] No accidental client/server boundary violations.
- [ ] No unrelated refactor, package change, or public contract change.
- [ ] Ran the relevant `package.json` scripts (lint/typecheck/test/build) when possible.
- [ ] Reported actual results and any checks not executed.

## Required final response format for coding tasks
1. Changes: files modified and why.
2. Verification: commands executed and pass/fail (or not run + reason).
3. Risks: known assumptions, tradeoffs, or follow-ups.
