---
paths:
  - "**/Features/**/*.cs"
  - "**/Application/**/*.cs"
---
# 04 — CQRS / MediatR

Applies when the repository already uses CQRS/MediatR. Do not introduce it into a service without approval.

## MUST
- Commands modify state; queries read state. Query handlers must not call `SaveChangesAsync`.
- Keep one primary command/query and handler per use case; use meaningful DTO/result types.
- Pass `CancellationToken` to MediatR, EF Core and external I/O.
- Validate at the boundary/pipeline according to existing validation strategy.
- Make transaction boundaries explicit for multi-write operations; do not claim implicit atomicity across external systems.
- Return typed results or well-defined domain exceptions according to the repository's error contract.
- Avoid returning EF tracked entities directly from application handlers.

## DON'T
```csharp
public async Task<Document?> Handle(GetDocumentQuery request, CancellationToken ct)
{
    var entity = await dbContext.Documents.FindAsync([request.Id], ct);
    entity!.LastViewedAt = DateTime.UtcNow;
    await dbContext.SaveChangesAsync(ct);
    return entity;
}
```
Query unexpectedly writes data and suppresses nullability.

## DO
```csharp
public sealed record GetDocumentByIdQuery(Guid Id) : IRequest<DocumentDto?>;

public sealed class GetDocumentByIdQueryHandler(AppDbContext dbContext)
    : IRequestHandler<GetDocumentByIdQuery, DocumentDto?>
{
    public Task<DocumentDto?> Handle(
        GetDocumentByIdQuery request,
        CancellationToken cancellationToken)
    {
        return dbContext.Documents
            .AsNoTracking()
            .Where(document => document.Id == request.Id)
            .Select(document => new DocumentDto(document.Id, document.Title))
            .SingleOrDefaultAsync(cancellationToken);
    }
}
```
Assumes `DocumentDto` and `AppDbContext` exist. The handler uses EF directly only when permitted by current project architecture.

## Consistency
- Use `CreateDocumentCommand` / `CreateDocumentCommandHandler` rather than generic `DocumentHandler`.
- Avoid generic result wrappers unless the project uses them consistently.
- Do not over-fragment a simple use case into unnecessary mediators or services.
