# 08 — Testing, Quality Gates and Agent Delivery

## Before implementation
- Read `CLAUDE.md`, applicable rules, `.editorconfig`, existing feature examples and `.csproj`.
- State which feature files will change. Preserve public contracts unless explicitly changing them.

## During implementation
- Add/modify focused unit tests for business rules and handlers.
- Use integration tests for database behavior, routes, validation, permissions or transaction boundaries where appropriate.
- Avoid brittle tests that assert internal implementation instead of behavior.
- Use deterministic test fixtures; never require production credentials or write to production systems.
- Do not modify unrelated snapshots or tests to mask failures.

## Good test name
```csharp
[Fact]
public async Task Handle_WhenDocumentDoesNotExist_ReturnsNull()
{
    // Arrange, Act, Assert; use existing test fixture/mocks.
}
```

## Checklist
- [ ] Naming and folder placement consistent with nearby code
- [ ] Nullable warnings addressed correctly
- [ ] HTTP / handler / database cancellation passed through
- [ ] Query is read-only, commands control writes
- [ ] AuthN/AuthZ and validation preserved
- [ ] No raw SQL injection, secrets, or sensitive logging
- [ ] No unapproved dependencies/migrations/TFM changes
- [ ] Build and relevant tests executed, or marked not run
- [ ] Changed files, behavior and known risks summarized

## Commands (only if environment allows)
```bash
dotnet restore
dotnet build --no-restore
dotnet test --no-restore
dotnet format --verify-no-changes
```
Never state tests passed without observing their output. Avoid auto-fixing entire repositories for scoped tasks.
