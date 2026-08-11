# Provider capabilities and persistent health checks

## Request
Consume WebApi runtime capabilities before each AI request, remove Basketra-owned provider attachment-size policy, run the real provider capability probe automatically at startup without blocking service availability, persist the latest probe result in SQLite, expose it in Settings, and keep the existing manual probe button.

## Evidence
- Basketra currently advertises an 8 MiB file limit from its own transport/storage configuration even though WebApi owns the effective ChatGPT attachment limits.
- Basketra sends stored files as base64 JSON, so the current shared request/file limit produces an effective binary limit below the advertised value.
- The existing provider probe is manual and its outcome only appears in logs/UI state.
- The existing ai_executions table can persist bounded provider-check status without adding a parallel health table.

## Decision
1. Separate Basketra transport/storage safety bounds from provider limits. Basketra does not invent an AI image/file limit.
2. The OpenAI-compatible provider fetches GET capabilities from its configured base URL before every AI request. When capabilities are available, validate the outgoing attachment against them; if the endpoint is unsupported, let the provider remain authoritative and do not apply a Basketra provider-size limit.
3. Cache nothing across AI requests. Live WebApi admin edits therefore affect the next Basketra request.
4. Record startup and manual capability probes in ai_executions using operation provider-capability-probe; store only bounded non-sensitive metadata.
5. Start the automatic probe immediately after the server is listening, but never fail startup because the optional AI provider is unavailable.
6. Return the latest persisted probe result from the existing AI settings endpoint and render status, last-check timestamp, trigger and error/success in Settings. Preserve the manual probe button.
7. Fix the base64 transport mismatch by using a separate JSON-envelope safety limit large enough for the configured file storage ceiling; provider limits remain independent and dynamic.

## Scope
Provider capability discovery, per-request validation, Basketra transport limit separation, persistent health result, startup/manual probe orchestration, Settings UI, regression tests and docs.

## Risks
Capabilities fetch adds one small authenticated request per AI request by design. Provider-unavailable startup probes must not delay or fail readiness. Persisted diagnostics must never include credentials, receipt text or filesystem paths.

## Tests
Capabilities parsing and attachment validation; capabilities fetched for each execute; unsupported capability endpoint fallback; provider probe persistence; startup probe is non-fatal; manual probe updates persisted result; settings response/UI contract; base64 transport regression; canonical quality/CI.

## Acceptance
WebApi is the provider-limit SSOT; no Basketra-owned AI image-size constant; each AI request observes current capabilities; startup/manual probe results persist and display with last-checked time; manual button remains; final PR head is green.

## Rollback
Revert the PR. Provider-check rows in ai_executions are compatible historical telemetry and require no schema rollback.

## Delivery status
Implementation in progress on agent/feat-provider-capabilities-health.
