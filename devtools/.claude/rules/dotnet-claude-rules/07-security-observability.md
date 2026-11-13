---
paths:
  - "**/*.cs"
  - "**/appsettings*.json"
---
# 07 — Security, Logging and Observability

## Security
- Never commit secrets or place tokens/passwords/API keys in source or logs.
- Use configuration/secret management approved by the repository; minimize privilege.
- Enforce authentication and resource-level authorization on backend endpoints.
- Validate user input; use parameterized database operations.
- Check cancellation, timeouts and retry safety for external dependencies.
- Do not weaken TLS, authentication, CORS or rate limits to make tests pass.

## Observability
- Use `ILogger<T>` and structured message templates; never string-interpolate log values.
- Log actionable, non-sensitive context, including correlation IDs where present.
- Treat exception logging and API error payloads separately: internal details may go to protected logs, not responses.
- Do not add telemetry exporters or agents without approval; use existing OpenTelemetry/Serilog/Grafana integration if configured.

## DON'T
```csharp
logger.LogInformation($"Token: {accessToken}; User: {email}");
```

## DO
```csharp
logger.LogInformation(
    "Document {DocumentId} submitted by actor {ActorId}",
    documentId,
    actorId);
```
Even identifiers may be sensitive in some environments; follow team data-classification policy.
