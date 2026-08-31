# Dynamic upload capability feedback

## Request

Basketra must not own or hard-code AI attachment limits. WebAPI is the single source of truth and exposes its effective limits through `GET /v1/capabilities`. Basketra must resolve those limits dynamically so runtime changes in WebAPI are reflected without restarting Basketra. When an image exceeds the current WebAPI image limit, the UI must show both the selected image size and the live limit.

## Evidence

- WebAPI already exposes `GET /v1/capabilities` with live attachment limits.
- Basketra's `OpenAiCompatibleProvider` already fetches `/v1/capabilities` before every AI execution, validates the response without caching it and prevents oversized attachments from reaching the AI request.
- Basketra historically exposes `metadata.files.maxBytes` from its local `FileStore`, constructed from `BASKETRA_MAX_BODY_BYTES`. The upload flow no longer consumes that field as functional AI policy and `FileStore` no longer rejects a file merely for exceeding it.
- `src/web/receipt-capture.js` previously validated against metadata loaded during application initialization, so a later WebAPI runtime limit change was not observable to upload UX.
- Basketra's receipt UX explicitly keeps AI optional and must never make WebAPI availability or an AI-only attachment limit block capture persistence or local OCR.
- Basketra still needs bounded HTTP transport and persistent-storage guards for denial-of-service/resource protection; those safeguards are infrastructure limits, not WebAPI AI capabilities and must not be presented as functional image limits.
- Removing the existing `files.maxBytes` property from `/api/v1/meta` would be a public API contract change. It is therefore retained for compatibility in this task rather than removed silently.

## Decision

- Keep WebAPI `GET /v1/capabilities` as the canonical functional attachment-limit contract.
- Keep `OpenAiCompatibleProvider` as the single parser and enforcement owner for WebAPI runtime capabilities. It re-reads WebAPI immediately before every AI execution and never caches the result.
- Basketra exposes a narrow same-origin capability preflight endpoint for browser UX. The endpoint performs a fresh authenticated WebAPI request for every call, uses `cache: no-store`, bounds the response size and never exposes the WebAPI token.
- The same-origin preflight is schema-neutral: it transports WebAPI's live JSON for advisory UX and does not duplicate the provider's capability schema/parser.
- Keep `/api/v1/meta` independent of WebAPI availability. Treat its existing `files.maxBytes` member as legacy transport metadata only; Basketra UI and AI policy must not consume it as an attachment capability. Removing it requires a separately approved API migration.
- The browser performs advisory capability preflight immediately before an AI-enabled upload batch. If a current WebAPI limit is available, oversized feedback shows both selected size and live limit.
- Capability-preflight failure or an AI-only size excess must not block capture persistence or local OCR. The canonical provider boundary re-reads WebAPI before AI transmission and prevents an out-of-limit attachment from being sent.
- Remove the per-file functional size policy from `FileStore`; persistent-storage capacity remains a separate operational safeguard.
- Keep Basketra's request-body bound only as a transport/DoS safeguard. It must not be presented as the provider image limit.

## Acceptance

- WebAPI remains the only owner of functional AI attachment-size limits.
- Every Basketra capability-preflight request performs a fresh WebAPI capabilities request with no cache.
- Every actual AI execution independently performs a fresh WebAPI capabilities request before sending attachments.
- Changing WebAPI `maxImageBytes` is observable by Basketra without restarting either service.
- Oversized-image feedback states the selected image size and current WebAPI limit in the same message when live capabilities are available.
- An oversized AI attachment remains stored and available to local OCR instead of being rejected by Basketra's upload flow.
- A temporary capability-preflight failure does not block capture persistence or local OCR.
- The canonical AI boundary does not send an attachment that exceeds the current WebAPI capability.
- Basketra no longer rejects stored files using a locally configured functional per-file maximum.
- Existing MIME/signature validation and persistent-storage capacity protection remain intact.
- Basketra bootstrap metadata remains available when WebAPI is unavailable.
- The legacy `/api/v1/meta.files.maxBytes` field is not consumed by the upload UX or AI policy.
- Tests cover live capability re-resolution, gateway error envelopes, nonblocking browser behavior and readable oversize feedback.

## Risks

- `BASKETRA_MAX_BODY_BYTES` can still reject an HTTP request before file decoding if operators configure it below the encoded request size. This remains a transport safety setting, not an advertised AI image capability; deployment documentation must avoid presenting it as a functional provider limit.
- Advisory preflight can race with a WebAPI settings change. The canonical provider re-read immediately before AI transmission is therefore mandatory and authoritative.
- An attachment can be persisted and OCR-processed locally even when WebAPI will reject it for AI. This is intentional: evidence and local OCR must remain usable, and the UI exposes the live AI limit when available.
- `/api/v1/meta.files.maxBytes` remains for backward compatibility and can be misinterpreted by external consumers. Its eventual removal requires explicit approval because it breaks the public response contract.

## Checks

- Existing provider unit tests proving live capability reads before every AI execution and enforcement before transmission.
- Integration tests for same-origin capability preflight, fresh re-resolution and error envelopes.
- Unit/integration tests for file storage without a local functional per-file limit.
- Browser regression test for fresh limit resolution, readable oversize feedback and nonblocking local OCR.
- `pnpm quality` through CI.
- Browser E2E and visual-evidence workflows required by repository impact policy.
- Container smoke/security/CodeQL for the final head.

## Delivery

Branch: `agent/fix-upload-size-feedback`.
Coordinated with WebAPI branch `agent/fix-live-ai-capabilities` and PR #106.
Basketra PR: #42.
No merge, release or deployment is authorized.

## Status

Implementation validated on runtime head `5a1295bbd7dad73712a7bf2714e6b2513322fb35`: Quality, 61/61 Browser E2E, security, container smoke, amd64/arm64 builds, CodeQL and visual-evidence publication passed after evidence-based retries of two unrelated CI flakes. This documentation-only commit records the final architecture and compatibility decision; canonical CI for its resulting head remains authoritative before delivery.
