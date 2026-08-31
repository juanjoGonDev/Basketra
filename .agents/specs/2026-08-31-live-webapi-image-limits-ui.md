# Live WebAPI image limits in upload UI

## Request

Fix the regression left after PR #42: every AI image-upload path must obtain the current attachment limit from WebAPI instead of treating Basketra `meta.files.maxBytes` / `BASKETRA_MAX_BODY_BYTES` as the functional image limit. The UI must show the current WebAPI image/file limits and oversized feedback must include both the selected file size and the supported maximum.

## Evidence

- `src/web/receipt-capture.js` performed a WebAPI capability preflight only when receipt AI was configured and enabled, and silently ignored capability lookup failures.
- `src/web/lists.js::uploadProductImage()` rejected with `file.size > metadata.files.maxBytes` and the generic message `La imagen supera el límite configurado`.
- `/api/v1/meta.files.maxBytes` is derived from Basketra `FileStore.maxBytes`, which is initialized from `BASKETRA_MAX_BODY_BYTES`; that value is a transport/body safeguard, not the functional WebAPI attachment policy.
- The provider re-reads `/v1/capabilities` before structured AI execution, but the browser product-photo path could fail against Basketra metadata before the request reached that boundary.

## Decision

- Keep `BASKETRA_MAX_BODY_BYTES` as a transport/DoS safeguard only. Do not present it as the AI image policy.
- Product-photo AI preflight fetches `/api/v1/ai/runtime-capabilities` with `no-store` for every selected image before AI processing.
- Receipt upload keeps local OCR/storage available when the image is over the AI limit, while the UI exposes the current live WebAPI limit and the warning contains actual and maximum sizes.
- UI capability lookup failures are visible as WebAPI-limit availability state; they do not silently fall back to a Basketra functional limit.
- Ticket limits are refreshed on receipt initialization so users see the current WebAPI image/PDF limits before selecting a file.
- The provider remains the server-side authority immediately before transmission.

## Acceptance

- Product-photo upload no longer reads `metadata.files.maxBytes` as its functional AI limit.
- Every product-photo selection queries live WebAPI runtime capabilities before AI upload/analysis.
- An oversized product image reports filename, selected size, and current WebAPI maximum.
- Ticket UI visibly reports current WebAPI image/PDF limits before upload when available.
- Ticket oversized warning continues to preserve local OCR/storage and reports selected size plus maximum.
- Capability lookup failure does not substitute a Basketra limit.
- Regression tests cover product-photo live limit refresh, exact error copy, visible limits, unavailable capabilities, and existing receipt local-OCR behavior.

## Checks

Validated on implementation head `db74b1919c6859f9a3e89c6115b7f14898640bbb` before this documentation-only closeout:

- Pull Request Quality run `33407545028`: success.
- CodeQL Advanced run `33407544822`: success.
- Publish PR visual evidence run `33407545155`: success.
- Browser E2E is included in Pull Request Quality and passed on that exact head.
- Container amd64, arm64, smoke, security, quality and browser jobs passed as part of the authoritative quality workflow.

The previous head `bb4866fd76c98b2f8ed51d8241ef6315de238e08` had a Browser E2E failure. That head is superseded and is not used as delivery evidence; the final implementation head above passed the replacement authoritative run.

## Delivery

PR #43: `fix(upload): enforce live WebAPI image limits in UI`.

No merge, release, publish, deploy, secret change or migration is included.

## Status

Implementation and regression coverage complete. Final documentation-only head requires its own exact-head CI before handoff.
