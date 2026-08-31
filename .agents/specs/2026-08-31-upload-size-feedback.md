# Upload size feedback

## Request

When Basketra rejects an image because it exceeds the configured upload limit, show both the selected file size and the current server-provided limit.

## Evidence

- `spec.md` defines backend configuration exposed by `/api/v1/meta` as the single source of truth for file limits.
- `src/web/receipt-capture.js` already validates `file.size` against `metadata.files.maxBytes`, but its oversize error only reports the limit.
- The change belongs in Basketra; WebAPI does not own Basketra's upload acceptance limit.

## Decision

Keep `metadata.files.maxBytes` authoritative. Improve only the client-side feedback so an oversized selection reports the actual selected-file size and the configured maximum using a human-readable byte formatter. Do not duplicate or hard-code the limit.

## Acceptance

- Oversized image feedback states the current file size and configured limit in the same message.
- Values are human-readable and retain useful precision around the boundary.
- The limit still comes exclusively from `/api/v1/meta` metadata.
- Existing valid upload behavior is unchanged.
- A browser regression test covers the user-visible oversized-file message.

## Checks

- Browser regression test for oversized selection.
- `pnpm quality` through CI.
- Visual-evidence workflow if repository impact policy requires it.

## Delivery

Branch: `agent/fix-upload-size-feedback`.
No merge, release or deployment is authorized.

## Status

In progress.
