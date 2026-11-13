---
paths:
  - "**/*.cs"
---
# 02 — Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Namespace / class / record / enum / interface members | PascalCase | `CreateDocumentCommand` |
| Interface | `I` prefix + PascalCase | `IDocumentRepository` |
| Method | PascalCase | `GetDocumentAsync` |
| Async method | `Async` suffix (unless framework method naming requires otherwise) | `SaveChangesAsync` |
| Method parameters and locals | camelCase | `documentId` |
| Private instance fields | `_camelCase` | `_logger` |
| Private static readonly fields | `_camelCase` (team choice) | `_cacheKey` |
| Constants | PascalCase | `MaxRetryCount` |
| Boolean | Positive, intention-revealing name | `isApproved`, `hasPermission` |
| Request / response DTO | Purpose suffix | `CreateDocumentRequest`, `DocumentResponse` |
| CQRS | Action + entity + Command/Query | `ApproveDocumentCommand` |
| Handler | Request name + Handler | `ApproveDocumentCommandHandler` |
| Validator | Request name + Validator | `ApproveDocumentCommandValidator` |
| Tests | Action_Condition_ExpectedResult | `Handle_WhenMissing_ThrowsNotFound` |

## DON'T
```csharp
public class docService
{
    private readonly ILogger<docService> logger;
    public Task<bool> doIt(int id) => Task.FromResult(true);
}
```

## DO
```csharp
public sealed class DocumentService(ILogger<DocumentService> logger)
{
    public Task<bool> CanApproveAsync(Guid documentId, CancellationToken cancellationToken)
    {
        logger.LogDebug("Checking document approval eligibility for {DocumentId}", documentId);
        return Task.FromResult(documentId != Guid.Empty);
    }
}
```
Primary constructor is illustrative: use only when supported by the project's C# version and conventions.

## Notes
- Respect public JSON and database naming contracts; never rename external contract fields solely for style.
- Do not abbreviate domain terminology unpredictably (`Doc` in one layer, `Document` in another).
- EF entity class names generally singular; `DbSet` collection property names generally plural unless mapping conventions dictate otherwise.
