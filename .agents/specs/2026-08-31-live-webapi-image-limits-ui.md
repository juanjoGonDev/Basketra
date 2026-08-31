# Live WebAPI image limits in upload UI

## Request

Fix the regression left after PR #42: every AI image-upload path must obtain the current attachment limit from WebAPI instead of treating Basketra `meta.files.maxBytes` / `BASKETRA_MAX_BODY_BYTES` as the functional image limit. The UI must show the current WebAPI image/file limits and oversized feedback must include both the selected file size and the supported maximum.

## Evidence

- `src/web/receipt-capture.js` performs a WebAPI capability preflight only when receipt AI is configured and enabled, and silently ignores capability lookup failures.
- `src/web/lists.js::uploadProductImage()` still rejects with `file.size > metadata.files.maxBytes` and the generic message `La imagen supera el límite configurado`.
- `/api/v1/meta.files.maxBytes` is derived from Basketra `FileStore.maxBytes`, which is initialized from `BASKETRA_MAX_BODY_BYTES`; that value is a transport/body safeguard, not the functional WebAPI attachment policy.
- The provider re-reads `/v1/capabilities` before structured AI execution, but the browser product-photo path can fail against Basketra metadata before the request reaches that boundary.

## Decision

- Keep `BASKETRA_MAX_BODY_BYTES` as a transport/DoS safeguard only. Do not present it as the AI image policy.
- Product-photo AI preflight must fetch `/api/v1/ai/runtime-capabilities` with `no-store` for every selected image before AI processing.
- Receipt upload must keep local OCR/storage available when the image is over the AI limit, but its UI must expose the current live WebAPI limit and the warning must contain actual and maximum sizes.
- UI capability lookup failures must be visible as WebAPI-limit availability state; they must not silently fall back to a Basketra functional limit.
- The provider remains the server-side authority immediately before transmission.

## Acceptance

- Product-photo upload no longer reads `metadata.files.maxBytes` as its functional AI limit.
- Every product-photo selection queries live WebAPI runtime capabilities before AI upload/analysis.
- An oversized product image reports filename, selected size, and current WebAPI maximum.
- Ticket UI visibly reports current WebAPI image/PDF limits when available.
- Ticket oversized warning continues to preserve local OCR/storage and reports selected size plus maximum.
- Capability lookup failure does not substitute a Basketra limit.
- Regression tests cover product-photo live limit refresh, exact error copy, visible limits, and existing receipt local-OCR behavior.

## Checks

- `pnpm test`
- `pnpm quality`
- focused Playwright upload tests
- Pull Request Quality / CodeQL / visual evidence on the exact PR head

## Delivery

Create an atomic fix PR. Do not merge, release, publish, deploy, or change secrets.

## Status

Implementation in progress.
