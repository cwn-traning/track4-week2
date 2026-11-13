---
paths:
  - "**/*DbContext.cs"
  - "**/Persistence/**/*.cs"
  - "**/Repositories/**/*.cs"
  - "**/Features/**/*.cs"
---
# 05 — EF Core + PostgreSQL

## Rules
- Apply `AsNoTracking()` for read-only queries unless change tracking is required.
- Project only needed columns to DTOs when sensible; avoid `ToList()` before filtering/pagination.
- Use EF LINQ parameterization; never concatenate untrusted input into SQL.
- Use `CancellationToken` on async EF operations.
- Prevent N+1 queries; choose projections/Include based on actual access patterns.
- Use deterministic ordering before pagination; enforce bounded page size.
- Prefer `ExecuteUpdateAsync`/`ExecuteDeleteAsync` only when bulk semantics, interceptors, domain hooks and concurrency implications are understood.
- Make concurrency handling explicit for important updates (row version, concurrency tokens or conditional update).
- Do not generate/apply migrations, or change column types/timezone semantics, without authorization.
- Preserve existing PostgreSQL `timestamp with time zone` vs `timestamp without time zone` behavior; document timezone conversions and avoid double-conversion.
- Keep transactions as short as practical; avoid network calls inside database transactions.

## DON'T
```csharp
var items = await dbContext.Documents.ToListAsync();
return items.Where(item => item.Status == status).Take(20).ToList();
```

## DO
```csharp
var documents = await dbContext.Documents
    .AsNoTracking()
    .Where(document => document.Status == status)
    .OrderByDescending(document => document.CreatedAt)
    .ThenBy(document => document.Id)
    .Take(20)
    .Select(document => new DocumentDto(document.Id, document.Title))
    .ToListAsync(cancellationToken);
```

## Review questions
- Could the query issue N+1 SQL or load unnecessary data?
- Is pagination stable, and is user-controlled page size bounded?
- Does the query need an index? Propose separately; do not migrate without approval.
- Could a bulk update bypass auditing, concurrency or EF tracking?
