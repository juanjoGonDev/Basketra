# Dynamic upload capability feedback

## Request

Basketra must not own or hard-code AI attachment limits. WebAPI is the single source of truth and exposes its effective limits through `GET /v1/capabilities`. Basketra must resolve those limits dynamically so runtime changes in WebAPI are reflected without restarting Basketra. When an image exceeds the current WebAPI image limit, the UI must show both the selected image size and the live limit.

## Evidence

- WebAPI already exposes `GET /v1/capabilities` with live attachment limits.
- Basketra's `OpenAiCompatibleProvider` already fetches `/v1/capabilities` before every AI execution and validates the response without caching it.
- Basketra currently exposes `metadata.files.maxBytes` from its local `FileStore`, constructed from `BASKETRA_MAX_BODY_BYTES`; that incorrectly makes Basketra a second owner of the functional image limit.
- `src/web/receipt-capture.js` validates against metadata loaded during application initialization, so a later WebAPI runtime limit change is not observed before the next upload.
- Basketra still needs a bounded HTTP transport guard for denial-of-service protection; that guard is infrastructure safety, not the AI provider's file capability and must not be exposed as the functional image limit.

## Decision

- Keep WebAPI `GET /v1/capabilities` as the canonical limit contract.
- Promote the existing provider runtime-capability fetcher to a reusable public method; AI execution and UI preflight consume the same parser and network path.
- Basketra exposes a narrow same-origin capability preflight endpoint for its browser. It performs a fresh WebAPI capability request for every call and never exposes the WebAPI token.
- Keep `/api/v1/meta` independent of WebAPI availability and remove its locally-derived functional `maxBytes` field.
- The browser calls the capability preflight immediately before validating each upload batch; it does not persist or hard-code the provider limit.
- Remove the per-file size policy from `FileStore`; persistent-storage capacity remains a separate operational safeguard.
- Keep Basketra's request-body bound only as a transport/DoS safeguard. It must not be presented as the provider image limit.
- If live WebAPI capabilities cannot be obtained, upload preflight fails with a recoverable capability error instead of silently falling back to a stale local number.

## Acceptance

- WebAPI remains the only owner of the functional attachment-size limits.
- Each Basketra capability-preflight request performs a fresh WebAPI capabilities request.
- Each upload batch resolves fresh capabilities before validating files.
- Changing WebAPI `maxImageBytes` is observed by Basketra without restarting either service.
- Oversized image feedback states the selected image size and the current WebAPI limit in the same message.
- Basketra no longer rejects stored files using a locally configured per-file maximum.
- Existing MIME/signature validation and persistent-storage capacity protection remain intact.
- Basketra bootstrap metadata remains available when WebAPI is unavailable.
- Tests cover live capability re-resolution, refreshed browser validation and readable oversize feedback.

## Risks

- WebAPI capability availability becomes part of upload preflight availability; errors must be explicit and retryable without blocking the rest of Basketra.
- `BASKETRA_MAX_BODY_BYTES` can still reject an HTTP request before file decoding if operators configure it below the encoded request size. This remains a transport safety setting, not an advertised image capability; deployment documentation must avoid configuring it below the supported WebAPI envelope.

## Checks

- Targeted unit tests for provider runtime capabilities.
- Integration tests for the same-origin capability preflight and file storage.
- Browser regression test for fresh limit resolution and oversized selection.
- `pnpm quality` through CI.
- Visual-evidence workflow if repository impact policy requires it.

## Delivery

Branch: `agent/fix-upload-size-feedback`.
Coordinated with WebAPI branch `agent/fix-live-ai-capabilities`.
No merge, release or deployment is authorized.

## Status

In progress.
