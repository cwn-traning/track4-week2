---
paths:
  - "**/Controllers/**/*.cs"
  - "**/Endpoints/**/*.cs"
  - "**/*Request.cs"
  - "**/*Response.cs"
---
# 06 — ASP.NET Core API

## MUST
- Consistent route naming, HTTP methods and status codes; match existing versioning conventions.
- Use typed DTOs at the API boundary. Avoid exposing EF entities directly.
- Apply validation to untrusted input and authorization to protected operations.
- Use `CancellationToken` in action signatures and forward it.
- Return `201 Created` with resolvable resource location for successful creation when appropriate; `204 No Content` for successful no-body deletes.
- Use the established centralized exception handling and ProblemDetails/error-envelope contract; do not leak stack traces.
- Do not introduce breaking changes to route, JSON, validation or status codes without explicit instructions.

## DON'T
```csharp
[HttpGet("{id}")]
public async Task<IActionResult> Get(Guid id)
{
    try { return Ok(await dbContext.Documents.FindAsync(id)); }
    catch (Exception ex) { return BadRequest(ex.ToString()); }
}
```

## DO
```csharp
[HttpGet("{id:guid}")]
public async Task<ActionResult<DocumentResponse>> GetById(
    Guid id,
    CancellationToken cancellationToken)
{
    var document = await mediator.Send(
        new GetDocumentByIdQuery(id), cancellationToken);

    return document is null
        ? NotFound()
        : Ok(new DocumentResponse(document.Id, document.Title));
}
```
Example assumes controller has mediator injection and DTOs; follow centralized error conventions for actual project.

## Response contract
- Match existing JSON naming and date format; don't create a second response envelope.
- Treat idempotency and retries explicitly for externally retried commands.
- Never trust UI permission controls as server-side authorization.
