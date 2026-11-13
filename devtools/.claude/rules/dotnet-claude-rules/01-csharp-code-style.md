---
paths:
  - "**/*.cs"
---
# 01 — C# Code Style

## MUST
- Use 4-space indentation, braces for control flow, one statement per line. Follow `.editorconfig` if different.
- Prefer file-scoped namespaces in new files if supported by the project.
- Prefer `var` when the type is obvious from the right side; otherwise explicit type. Never optimize for brevity over clarity.
- Use guard clauses to reduce nesting; prefer immutable or `readonly` state where practical.
- Enable and respect nullable reference types; do not add `!` simply to silence warnings.
- Use `async`/`await` for asynchronous I/O; never use `.Result` / `.Wait()` in request paths.
- Declare public APIs with clear return types. Prefer explicit `CancellationToken` propagation.
- Use dependency injection via constructors and avoid service locators.
- Use collection expressions, primary constructors or new language syntax only if supported by the project's configured C# version and established style.

## DON'T
```csharp
public async Task<List<UserDto>> Get(){var users=_db.Users.ToList();return users.Select(x=>new UserDto(x.Id,x.Name)).ToList();}
```
This blocks synchronously within an async method, does needless materialization and omits cancellation.

## DO
```csharp
public Task<List<UserDto>> GetUsersAsync(CancellationToken cancellationToken)
{
    return dbContext.Users
        .AsNoTracking()
        .Select(user => new UserDto(user.Id, user.Name))
        .ToListAsync(cancellationToken);
}
```

## Review
- [ ] No unnecessary `#region`, magic constants or dead comments
- [ ] No hidden sync-over-async
- [ ] Nullability handled explicitly
- [ ] Small cohesive methods and descriptive identifiers
