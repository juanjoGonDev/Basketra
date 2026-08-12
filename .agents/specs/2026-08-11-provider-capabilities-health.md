# Provider capabilities and persistent health checks

## Request
Consume WebApi runtime capabilities before each AI request, remove Basketra-owned provider attachment-size policy, send actual attachment bytes to WebApi with multipart instead of base64 JSON, run the real provider capability probe automatically at startup without blocking service availability, persist the latest probe result in SQLite, expose it in Settings, and keep the existing manual probe button.

## Evidence
- Basketra currently advertises an 8 MiB file limit from its own transport/storage configuration even though WebApi owns the effective ChatGPT attachment limits.
- Basketra historically serialized stored files as base64 JSON. That inflates requests and makes a shared JSON/file ceiling report a binary limit that the transport cannot actually reach.
- WebApi now supports multipart binary chat attachments while preserving JSON/base64 for existing consumers.
- The existing provider probe was manual and its outcome only appeared in logs/UI state.
- The existing ai_executions table can persist bounded provider-check status without adding a parallel health table.
- CI on head `cc8ad933b69ec7f8c6d31141fbd6977978788404` exposed that the local Node shim declared `Buffer` only as a runtime value while provider multipart code also uses it as a type.

## Decision
1. Separate Basketra transport/storage safety bounds from provider limits. Basketra does not invent an AI image/file limit.
2. The OpenAI-compatible provider fetches GET capabilities from its configured base URL before every AI request. When capabilities are available, validate outgoing attachment bytes against them; if the endpoint is unsupported, let the provider remain authoritative and do not apply a Basketra-owned AI size limit.
3. Cache nothing across AI requests. Live WebApi admin edits therefore affect the next Basketra request.
4. Requests containing local image/PDF data are sent as multipart/form-data: one `request` JSON metadata field plus repeated binary `files` fields. Basketra must not send those file bytes as base64 on the wire.
5. Text-only provider requests may remain application/json. Basketra does not fall back from multipart to base64 for file requests.
6. Record startup and manual capability probes in ai_executions using operation provider-capability-probe; store only bounded non-sensitive metadata.
7. Start the automatic probe immediately after the server is listening, but never fail startup because the optional AI provider is unavailable.
8. Return the latest persisted probe result from the existing AI settings endpoint and render status, last-check timestamp, trigger and error/success in Settings. Preserve the manual probe button.
9. Keep Basketra's own incoming transport/storage ceiling only as a local resource-safety concern. It is not a provider attachment policy and must not be presented as WebApi's image/file limit.
10. Keep the custom Node compatibility shim internally consistent: `Buffer` has a type-side alias to `Uint8Array`, matching the byte semantics used by multipart code, while runtime `Buffer` methods remain explicitly shimmed.

## Scope
Provider capability discovery, per-request validation, multipart binary provider transport, Basketra transport-limit separation, persistent health result, startup/manual probe orchestration, Settings UI, regression tests and docs.

## Risks
Capabilities fetch adds one small authenticated request per AI request by design. Multipart metadata and file bytes must remain bounded, and provider-unavailable startup probes must not delay or fail readiness. Persisted diagnostics must never include credentials, receipt text or filesystem paths.

## Tests
Capabilities parsing and attachment validation; capabilities fetched for each execute; actual multipart file bytes and filename/MIME on the wire; no base64 payload in multipart metadata; text-only JSON compatibility; unsupported capability endpoint behavior; provider probe uses multipart image bytes; provider probe persistence; startup probe is non-fatal; manual probe updates persisted result; settings response/UI contract; strict TypeScript compilation through the Node shim; canonical quality/CI.

## Acceptance
WebApi is the provider-limit SSOT; no Basketra-owned AI image-size constant; each AI request observes current capabilities; every Basketra file request sends binary multipart rather than base64; startup/manual probe results persist and display with last-checked time; manual button remains; final PR head is green.

## Rollback
Revert the PR. Provider-check rows in ai_executions are compatible historical telemetry and require no schema rollback.

## Delivery status
Implementation in progress on agent/feat-provider-capabilities-health. CI compile failure on `Buffer` type/value parity has an evidence-based fix pending canonical CI validation.
