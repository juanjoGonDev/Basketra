# Automatic Receipt Review Flow

## Request

Make the Tickets workflow continuous and review-first instead of presenting a separate processing step. Uploading a capture starts OCR automatically. AI remains an optional correction layer: its failure must never discard or block usable local OCR. Manual correction must keep the original capture available as visual evidence, and an AI failure must expose explicit manual-review and AI-only retry actions.

## Evidence

- The previous UI exposed `Paso 2`, `Leer con OCR local`, the AI switch, global progress, manual fields, and expanded per-image status as simultaneous top-level controls.
- The receipt pipeline already had a bounded two-slot page queue, local OCR support for JPEG/PNG, persisted captures, and recovery metadata, but the UI still required a separate manual processing action.
- AI verification failures were represented as page failures even after usable OCR had been produced, which made an optional correction layer block review.
- The receipt redesign introduced split frontend modules; every new module and stylesheet must remain in the server static allowlist and service-worker shell cache.
- Manual visual review of browser evidence found that keeping a completed global progress panel visible duplicated the per-capture status and review state, so successful processing now removes that transient summary before review.
- Exact-head browser evidence for implementation head `562e917ff62324c57bc5925f8216f65dc8c53f4a` was manually inspected after the successful browser workflow. It shows collapsed analysis options, automatic OCR without a second processing step, compact per-capture summaries, the grouped `Revisión del ticket` disclosure, source-capture context, editable receipt rows, and the recovered AI state collapsed after a successful AI-only retry.

## Decision

- There is no visible primary `Paso 2` and no `Leer con OCR local` start button.
- A successful upload automatically starts the bounded two-slot OCR pool for the newly stored captures.
- AI configuration lives under collapsed `Opciones de análisis`. When available it may be enabled as an optional correction pass, but local image OCR always remains the first durable result.
- For JPEG/PNG, an `AI_*` failure after OCR is non-blocking: the page remains reviewable, the sanitized failure is attached to the AI state, and the card exposes both `Revisar manualmente` and `Volver a analizar con IA`.
- `Volver a analizar con IA` reuses the preserved OCR text and attachment; it does not rerun OCR.
- PDF keeps its existing provider/manual boundary because there is no local PDF OCR implementation. Provider failure preserves the original capture and offers manual recovery.
- Capture cards keep primary file identity/actions compact. Processing/recovery details are collapsed by default except for currently active or failed work that needs user attention.
- The combined review is a progressive `Revisión del ticket` section. It keeps a selectable original capture next to the editable receipt model; switching reference capture must not discard edits.
- `Datos, total y acciones manuales` is a nested disclosure rather than permanently visible form chrome.
- The transient global processing summary is visible only while work is active; once all pages are assembled it is hidden so the review becomes the single primary task.
- Source image URLs continue using the existing same-origin `/api/v1/files/<storageKey>` route with private/no-store semantics. PDF remains a non-preview document reference.
- No database, receipt-confirmation contract, authentication model, provider protocol, or dependency is changed.

## Acceptance

1. Uploading one or more supported images starts OCR without another user action.
2. At most two image OCR tasks run concurrently and queued captures advance as slots become free.
3. The Tickets view contains no visible `Paso 2` or `Leer con OCR local` processing gate.
4. AI options and completed per-capture details do not occupy primary screen space by default.
5. If AI correction fails after OCR, the capture is not marked as a fatal page error and OCR-derived rows remain reviewable.
6. AI failure exposes `Revisar manualmente` and `Volver a analizar con IA`; upstream/private provider detail is not exposed.
7. AI-only retry reuses the OCR draft and does not issue another OCR request.
8. Manual review opens with the affected original capture selected and editable rows available.
9. Changing the reference capture preserves current manual edits.
10. Successful assembly hides the transient processing summary before review.
11. PDF provider failure preserves the PDF and permits manual entry/review.
12. Existing cancellation, retry, confirmation, evidence preservation, retailer detection, offline shell, accessibility, and no-horizontal-overflow behavior remain covered.
13. All split receipt assets are served by the static allowlist and included in the versioned service-worker shell.

## Checks

Canonical delivery requires the exact PR head to pass:

- `pnpm quality`, including diff coverage and browser diff coverage.
- Browser E2E covering automatic two-slot OCR, grouped controls, local OCR recovery, AI non-blocking recovery, AI-only retry, manual source switching, cancellation, responsive layouts, keyboard focus, and offline shell.
- Security, container smoke, amd64/arm64 container builds, and CodeQL.
- PR visual-evidence publication followed by manual inspection of the Tickets workflow at mobile width.

Concrete workflow run IDs and the exact validated commit belong in the PR delivery description so this task specification does not duplicate volatile CI metadata.

## Delivery

Implemented on PR #32 (`agent/ui-android-native-redesign`) through atomic commits covering the workflow contract, browser regressions, receipt module/static-asset fixes, grouped review UX, CI browser setup hardening, completed-progress cleanup, and visual-evidence publisher maintenance. No merge, release, deployment, migration, dependency, or API-contract operation is part of this task.

## Status

Implementation and manual visual review are complete. The implementation head passed the full quality matrix and CodeQL, and its exact-head visual-evidence publisher completed successfully. This documentation-only closeout commit must pass the same exact-head checks; after that, merge remains gated only by explicit user approval.
