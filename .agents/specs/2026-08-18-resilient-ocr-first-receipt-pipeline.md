# Resilient OCR-first receipt pipeline

## Request

Make local OCR the durable base result for every receipt image. AI verification must be an optional enrichment stage that can fail without discarding or blocking deterministic OCR items. Preserve the relationship between every parsed item and its originating capture so failed AI can be retried for only that capture and manual review can show the corresponding image beside the editable row.

The accepted flow is:

`capture -> OCR evidence -> deterministic structured items -> arithmetic review -> optional AI enrichment -> manual review/import`

The user explicitly approved implementation in PR #32.

## Evidence

- `src/ocr/provider.ts` already asks Tesseract for TSV output, which contains line/word coordinates and confidence, but `parseTesseractTsv` currently discards geometry.
- `src/receipts/extraction.ts` already owns deterministic receipt parsing, metadata extraction and arithmetic review; this remains the SSOT for non-AI structuring.
- `ReceiptExtractionService` owns separate shared OCR(2) and AI(1) queues.
- Current `verifyOcrPagesInOrder` propagates an AI exception, causing the whole extraction job to fail even after OCR succeeded.
- Browser state already retains each capture by `storageKey` and can submit prior OCR text as `embeddedText`, which avoids another Tesseract process during an AI-only retry.
- Receipt rows currently preserve `sourceLines`, but the assembled review does not retain a stable capture association and the contextual editor does not show the source image.

## Decision

1. OCR is authoritative evidence, not a schema-producing AI call. Tesseract returns text plus line-level confidence and layout geometry when available.
2. `src/receipts/extraction.ts` remains the single deterministic parser owner. Extend it to consume OCR line evidence, not create a second parser.
3. Structured deterministic items carry optional provenance (`captureStorageKey`, source lines/region) and per-field confidence. These fields are evidence metadata, not import/business inputs.
4. Arithmetic validation remains canonical through existing receipt validators. Confidence helps prioritize review but never overrides arithmetic mismatches.
5. AI verification failure is represented per page as a recoverable warning. The extraction job still completes with deterministic items and metadata.
6. Successful AI may enrich/correct only the page it verified. Original OCR text, layout and deterministic items remain preserved alongside AI output.
7. AI-only retry reuses the stored capture plus its already persisted OCR text as `embeddedText`; this must not start local Tesseract again. The server still routes AI through the canonical AI queue.
8. Browser page state distinguishes OCR completion from AI state (`completed`, `warning`, retrying). A page with successful OCR and failed AI is reviewable and importable after human review.
9. Manual edits are authoritative. A later AI retry must not silently overwrite a field the user has changed; AI results refresh only untouched OCR-derived values and otherwise remain advisory evidence.
10. Manual review from a capture warning opens the corresponding receipt row and keeps the source image visible. On compact screens use the existing contextual sheet; expanded screens use the same semantic dialog with a side-by-side evidence layout.
11. No new dependency, worker, database, external service or frontend polling is introduced.

## Scope

### In scope

- `.agents/specs/2026-08-18-automatic-receipt-pipeline.md` status/contract alignment
- `src/ocr/provider.ts`
- `src/receipts/extraction.ts`
- `src/receipts/service.ts`
- `src/web/state.js`
- `src/web/receipts.js`
- `src/web/app.js`
- `src/web/ui.js`
- existing receipt CSS if evidence/editor presentation needs it
- unit/browser/integration regressions for deterministic layout parsing, AI warning fallback, AI-only retry, source-image review and manual-edit precedence
- service-worker cache only if served shell assets change

### Out of scope

- changing OCR concurrency (2) or AI concurrency (1)
- a second parser implementation in frontend
- automatic final import
- database schema migration unless existing persistence cannot satisfy reload recovery
- replacing Tesseract or adding another OCR dependency
- merge/release/deploy

## UX flow

1. User uploads an image.
2. OCR runs automatically in the existing bounded OCR queue.
3. As soon as OCR succeeds, deterministic items become valid review data and keep their capture/source-line provenance.
4. If AI is configured, the same page waits for the shared AI slot without blocking OCR capacity.
5. AI success enriches untouched OCR-derived fields.
6. AI failure changes only the AI state to warning; OCR items stay visible and usable.
7. The capture offers `Retry AI` and `Review manually`.
8. `Retry AI` uses existing OCR text plus the original image and never re-runs Tesseract.
9. `Review manually` opens the associated item with source image visible; edits are preserved and outrank later AI output.
10. Import remains an explicit reviewed action.

## Mobile

- Capture rows show a concise primary status (`OCR ready`, `Processing`, `OCR ready · AI warning`) and contextual actions only when needed.
- Review stays compact; tapping a row opens the existing bottom-sheet-style editor with the source image above the fields.
- The image remains zoomable and no fixed control obscures focused fields.
- AI warnings use text plus semantic styling, never color alone.

## Desktop

- The same editor presents source evidence and editable fields side-by-side when space permits.
- No separate desktop workflow or additional capability is introduced.

## Accessibility

- Existing native buttons/dialog semantics and keyboard focus contract remain.
- `Retry AI` and manual review have explicit accessible names.
- Warning state is announced in text and `aria-live` capture status.
- Source image has an informative alt label and remains optional for PDF captures.
- Focus returns to the originating compact row after closing the editor.

## Tests

- Tesseract TSV parser preserves ordered lines, confidence and normalized geometry.
- Deterministic parser maps source regions and field confidence without AI.
- Quantity/unit/total arithmetic continues to drive canonical review status.
- AI page failure returns a completed extraction with deterministic items plus a stable page warning.
- Abort/cancel still propagates and is not converted into an AI warning.
- A mixed multi-page extraction may contain AI-success and AI-warning pages simultaneously.
- Browser AI-only retry submits stored OCR as `embeddedText` and does not issue a new local OCR path.
- AI warning does not remove receipt rows or block review/import.
- Manual review launched from a capture warning opens a row tied to that capture and displays its image.
- Manual-edited fields are not silently overwritten when an AI retry completes.
- Existing concurrency tests remain authoritative: OCR <= 2, AI <= 1.
- Run `pnpm quality`, browser E2E, Security, container smoke, amd64/arm64 and CodeQL before delivery.

## Risks

- Provenance metadata must not leak into the receipt confirmation domain schema as authoritative business input.
- AI retry completion must merge evidence into the existing page instead of replacing original OCR geometry.
- Multiple jobs for one capture must restore in deterministic order after reload.
- Generic AI error mapping must not expose provider details to the browser.
- Layout geometry is unavailable for embedded/PDF/provider OCR; manual review must degrade to showing the full source instead of inventing a region.

## Rollback

All changes are additive/internal and can be reverted by task commits. No migration or destructive data operation is required.

## Delivery

- Branch: `agent/ui-android-native-redesign`
- PR: #32
- Atomic Conventional Commits.
- Do not merge without explicit authorization.

## Status

Accepted; implementation in progress.
