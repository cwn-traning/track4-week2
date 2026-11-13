---
paths:
  - "**/*.cs"
  - "**/*.csproj"
---
# 03 — Feature-Based Architecture

## Default layout for a new feature
```text
src/
  Company.Product.Api/
    Controllers/DocumentsController.cs
  Company.Product.Application/
    Features/Documents/
      Commands/CreateDocument/
        CreateDocumentCommand.cs
        CreateDocumentCommandHandler.cs
        CreateDocumentCommandValidator.cs
      Queries/GetDocumentById/
        GetDocumentByIdQuery.cs
        GetDocumentByIdQueryHandler.cs
        DocumentDto.cs
  Company.Product.Domain/
    Entities/Document.cs
  Company.Product.Infrastructure/
    Persistence/AppDbContext.cs
```

## Dependencies
- API → Application; Infrastructure implements interfaces/contracts defined inward.
- Application contains use-case orchestration; avoid ASP.NET `HttpContext` and EF provider-specific plumbing inside handlers if the repository already abstracts persistence.
- Domain business rules must not depend on Controllers, ASP.NET or EF Core packages.
- Use vertical slices for feature-specific contracts and validators; put shared code in common libraries only when genuinely reused.
- Prefer existing architectural boundaries. Do not introduce extra class libraries or repository abstractions solely because this template shows them.
- A controller/endpoint should only validate transport, authorize and dispatch/use-case compose; do not embed business workflows.

## DON'T
```csharp
[HttpPost]
public async Task<IActionResult> Create(CreateDocumentRequest request)
{
    // Controller performs mapping, DB operations, business decisions, and auditing.
    var entity = new Document { Title = request.Title };
    dbContext.Documents.Add(entity);
    await dbContext.SaveChangesAsync();
    return Ok(entity);
}
```

## DO
```csharp
[HttpPost]
public async Task<ActionResult<CreateDocumentResponse>> Create(
    CreateDocumentRequest request,
    CancellationToken cancellationToken)
{
    var result = await mediator.Send(
        new CreateDocumentCommand(request.Title), cancellationToken);

    return CreatedAtAction(nameof(GetById),
        new { id = result.Id },
        new CreateDocumentResponse(result.Id, result.Title));
}
```
`GetById` must exist and use a matching route. This example demonstrates boundary separation, not a complete controller.

## Rules
- Choose one existing pattern for a feature; do not mix Service CRUD and MediatR unpredictably.
- Keep all files for one command/query grouped together.
- Refactor cross-feature duplication only after evidence of shared domain behavior.
