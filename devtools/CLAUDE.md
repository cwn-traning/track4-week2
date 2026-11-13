# CLAUDE.md — listen · build · prove

ชุดนี้มี 2 ส่วนใน `.claude/`:

1. **Workflow "จาก interview สู่เว็บที่พิสูจน์ได้"** — `.claude/commands/` (00–11 + status) และ `.claude/skills/` (guide-*)
2. **Coding rules** — `.claude/rules/nextjs-claude-rules/` และ `.claude/rules/dotnet-claude-rules/` (โหลดอัตโนมัติตาม `paths:` ของแต่ละไฟล์)

## 1. Workflow (command 00–11)

ทุก command โหลด skill `guide-oracle` ก่อนเสมอ แล้วจึงโหลด guide ของขั้นนั้น · ทุก path นับจาก root ของโปรเจกต์

| ขั้น | Command | Skill | ผลลัพธ์ |
|---|---|---|---|
| 00 | `/00-check-machine` | guide-oracle | เช็กเครื่อง (อ่านอย่างเดียว) |
| 01 | `/01-listen-stories` | guide-requirement | `docs/00-INTERVIEW.md`, `docs/01-USER-STORIES.md` |
| 02 | `/02-listen-requirements` | guide-requirement | `docs/02-REQUIREMENTS.md` (FR / BR + ค่าขอบ 3 ค่า / NFR) |
| 03 | `/03-listen-design` | guide-diagram | `docs/03-DESIGN.md` (Mermaid) — ห้ามเขียนโค้ดเว็บ |
| 04 | `/04-listen-testdata` | guide-testdata | `docs/04-TEST-DATA.md` (ส่งลูกค้ายืนยัน = [D]) |
| 05 | `/05-build-prompt` | guide-testable-web | `docs/05-BUILD-PROMPT.md` — ห้ามเขียนโค้ดเว็บ |
| 06 | `/06-build-web` | guide-testable-web | `app/db/`, `app/web/` (+ `SPEC.md` = [A]) — ควรรันในเซสชันใหม่ |
| 07 | `/07-explore-3ways` | guide-testplan | `playwright/e2e/qa.config.json`, `playwright/07-EXPLORATION.md` |
| 08 | `/08-plan-test` | guide-testplan | `playwright/08-TEST-PLAN.md` (1–5), `08-TEST-RUN-1.md` |
| 09 | `/09-plan-review` | guide-testplan | `08-TEST-PLAN.md` (6–8), `playwright/09-PLAN-REVIEW.md` |
| 10 | `/10-prove-e2e` | guide-evidence | `playwright/e2e/` 3 เบราว์เซอร์ + GIF/MP4 + `index.html` |
| 11 | `/11-prove-bugs` | guide-evidence | `playwright/11-BUG-HUNT.md` |
| — | `/status` | guide-oracle | ดูว่าทำถึงขั้นไหน และ command ถัดไป (อ่านอย่างเดียว) |

กติกาหลัก (รายละเอียดใน `.claude/skills/guide-oracle/SKILL.md`):

- **"ลูกค้าขอ ≠ AI บอกว่าทำแล้ว ≠ เว็บทำจริง"** — งานคือพิสูจน์ ไม่ใช่เชื่อ
- ผลที่คาดหวังต้องติดป้ายที่มา **[D]** ลูกค้า > **[R]** กฎทั่วไป > **[A]** ผู้สร้าง/โค้ด > **[O]** หน้าจอ · ห้ามอบบั๊กลง expected
- `playwright/e2e/qa.config.json` คือแหล่งค่ากลางตั้งแต่ขั้น 07 (รายชื่อ module ต้องให้ผู้ใช้ยืนยัน)
- ขั้น 07–11 ห้ามแก้โค้ดเว็บ และห้ามแก้ expected ให้ test ผ่าน
- เว็บที่มีอยู่แล้ว: ข้าม 05–06 แล้วให้ `appPath` / `specPath` ใน qa.config.json ชี้ไปที่โค้ดและเอกสารเดิม

## 2. Next.js (App Router + TypeScript) rules

Rules: `.claude/rules/nextjs-claude-rules/` — ใช้กับ `src/**`, `app/**`, `tests/**` ตามที่ระบุใน `paths:`

1. Inspect neighboring files, `package.json`, `tsconfig.json`, and lint/format configuration before coding.
2. Reuse existing components, theme tokens, types, services, and utilities rather than duplicating them.
3. Keep changes within task scope. Do not rename, move, or format unrelated files.
4. Use TypeScript strict types. Never introduce `any`, `@ts-ignore`, or `eslint-disable` without explicit approval.
5. Prefer Server Components; add `"use client"` only at the necessary client boundary.
6. Put business feature code in `src/features/<feature>/`; keep `src/app/` focused on route wiring and composition.
7. Do not add dependencies, upgrade Next.js/React/MUI, change public APIs, or migrate architecture without approval.
8. Never expose credentials or server-only variables in client modules. Enforce authorization on the server.

Conventions: named `function` components + named exports (route entry files use default export) · `PascalCase.tsx` components · `useFeature.ts` hooks · other files `kebab-case` + role suffix (`user.service.ts`) · `interface` for props/contracts, `type` for unions/utility types · Prettier decides layout, ESLint enforces constraints.

| File | Responsibility |
|---|---|
| `01-code-style.md` | Readability, early returns, const, nullish coalescing |
| `02-naming-conventions.md` | Naming table and Do/Don't |
| `03-typescript-standards.md` | Strict typing, unions, safe boundary handling |
| `04-react-components.md` | Component declarations, props, client boundaries, MUI |
| `05-feature-architecture.md` | Feature ownership and file placement |
| `06-code-quality.md` | Review checklist and delivery report |

## 3. .NET (ASP.NET Core + EF Core/PostgreSQL) rules

Rules: `.claude/rules/dotnet-claude-rules/` — ใช้กับ `**/*.cs`, `*.csproj`, `appsettings*.json` ตามที่ระบุใน `paths:`

Priority: (1) task requirements + security → (2) existing repository architecture → (3) `.editorconfig`, analyzers, tests, CI → (4) `.claude/rules/`. When rules conflict, report it and choose the lowest-risk option; never silently change TFM, architecture, or dependencies.

- Nullable reference types and async APIs; pass `CancellationToken` HTTP → handler → EF Core.
- Preserve API contracts and database behavior unless the task requires changes.
- Never hardcode credentials, expose internal exceptions, or log tokens/PII. Authorization on the server.

| File | Responsibility |
|---|---|
| `01-csharp-code-style.md` | C# formatting and expression style |
| `02-naming-conventions.md` | Naming for C#, API, and CQRS |
| `03-feature-architecture.md` | Feature-based layout and dependency rules |
| `04-cqrs-mediatr.md` | Command/query/handler style |
| `05-efcore-postgresql.md` | Persistence conventions |
| `06-aspnet-api.md` | API conventions |
| `07-security-observability.md` | Security, logging, telemetry |
| `08-testing-quality.md` | Tests and delivery checklist |

## Definition of Done (ทุกงาน)

1. Report files changed and why.
2. Run only scripts that exist (`package.json` scripts; `dotnet build` / `dotnet test` / `dotnet format --verify-no-changes`) — never claim a check passed unless it was executed.
3. State skipped checks with reason, plus API/schema/security impact and remaining risks.
4. แจ้งผู้ใช้เมื่องานเสร็จทุกครั้ง โดยใช้ format ด้านล่าง (ครบทั้ง 5 หัวข้อ · หัวข้อไหนไม่มีให้เขียน "ไม่มี")

## Completion report format (บังคับ)

```markdown
### ✅ Summary
- ทำอะไรไป และผลลัพธ์คืออะไร (1–3 บรรทัด)

### 🔧 Files changed / created
- `path/to/file` — สร้างใหม่ / แก้ไข: เหตุผลสั้น ๆ

### ⚠️ Verification
- คำสั่งที่รันจริง → ผลลัพธ์ (ผ่าน / ไม่ผ่าน พร้อม output สำคัญ)
- สิ่งที่ไม่ได้ตรวจ → เหตุผล

### ➡️ Follow-ups / next
- งานที่ควรทำต่อ หรือ command ถัดไป (เช่น `/08-plan-test`)

### ⚠️ Blockers
- สิ่งที่ติดอยู่ / ต้องให้ผู้ใช้ตัดสินใจหรือยืนยัน (ไม่มี = "ไม่มี")
```

- ห้ามเขียนว่าตรวจผ่าน ถ้าไม่ได้รันคำสั่งนั้นจริง
