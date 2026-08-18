# Automatic receipt processing pipeline

## Request

Make receipt captures start processing automatically as soon as upload succeeds. Remove the explicit analysis step and reduce user interaction. New captures must join the existing OCR/AI capacity instead of cancelling current work:

- if an OCR slot is free, start OCR immediately;
- otherwise queue the capture;
- after OCR, use an AI slot when available if AI is configured;
- otherwise queue AI without blocking free OCR capacity;
- uploads arriving while other captures are processing must join the same global capacity model;
- keep review and explicit final import confirmation.

The user explicitly requested implementation in the current UI PR.

## Evidence

- `ReceiptExtractionService` already owns the canonical server-side concurrency: OCR/page queue concurrency is 2 and AI queue concurrency is 1.
- The OCR queue and AI queue are separate shared queues on the single service instance, so multiple extraction jobs naturally share the same limits.
- The existing browser flow still requires clicking `Leer con OCR local` after upload.
- The current upload path calls `invalidateExtraction()`, which cancels the active persisted extraction job. Therefore adding a capture while processing cannot currently join spare OCR/AI capacity.
- The browser stores only one active extraction-job id, while the server can run multiple persisted extraction jobs against the same shared OCR/AI queues.
- The progressive-disclosure redesign already separates capture, review and import concerns; an explicit Progreso/analysis step is no longer necessary when processing is automatic.

## Decision

1. Keep concurrency ownership on the server. Do not introduce a second OCR/AI capacity calculation in the browser.
2. Every successful upload batch is submitted as its own persisted receipt extraction job. Multiple jobs may be active at once; all share the service-level OCR(2) and AI(1) queues.
3. If AI is configured, automatic jobs use `verifyWithAi: true`; otherwise they use local OCR only. The ticket flow no longer asks the user to start analysis or toggle AI per upload.
4. Persist active job-to-capture mappings in local storage so background work can be recovered after reload. Retain compatibility with the legacy single-job key during migration.
5. Uploading additional captures invalidates only the assembled review, not already completed/active page work. Existing jobs are not cancelled.
6. Each job updates only the captures it owns. When every current capture is reviewable and no extraction job/submission is active, assemble the complete ticket once and open Revisión.
7. Ticket UI becomes three task areas: Capturas, Revisión, Importar. Processing state and cancellation live with Capturas because processing begins there automatically.
8. Do not expose fabricated per-stage timing. The UI may show queued/processing/completed while the canonical server queues decide whether a running capture is currently using OCR or waiting/using AI.
9. Retry submits only the failed/cancelled capture as a new persisted job. `Cancelar todo` cancels all active receipt jobs; per-capture cancellation cancels its owning job. If a job contains multiple captures, cancelling one necessarily cancels that batch; subsequent non-cancelled captures from that batch are re-queued automatically.
10. Keep explicit review/validation and final import confirmation. Automation must not bypass evidence review or idempotent confirmation.

## Scope

### In scope

- `src/web/state.js`
- `src/web/receipts.js`
- `src/web/app.js`
- `src/web/index.html`
- affected UI CSS
- browser/unit tests for automatic start, concurrent upload, queue recovery, retry/cancel, and reduced-step navigation
- service-worker cache version if shell assets change

### Out of scope

- changing OCR concurrency from 2
- changing AI concurrency from 1
- database schema/migrations
- provider/API request semantics
- automatic final receipt import
- deployment/release/merge

## Risks

- Multiple persisted jobs must not overwrite each other's page state.
- Adding a capture after a prior review was assembled must invalidate stale review data without discarding completed OCR/AI evidence.
- Cancelling one capture in a multi-capture upload batch cancels that server job. Remaining captures must be re-queued rather than silently lost.
- Reload recovery must associate only known capture storage keys with each persisted job.
- A failed job must mark only its own captures failed.
- Assembly must wait until every current capture is completed/manual and all active job submissions are settled.

## Acceptance

- Uploading one image starts processing without pressing an analysis button.
- The explicit `Leer con OCR local` action and per-ticket AI toggle are removed from the user flow.
- With three uploaded images, server OCR concurrency never exceeds 2 and AI concurrency never exceeds 1.
- A fourth capture uploaded while earlier work is active is submitted without cancelling the existing job and can use free server queue capacity.
- Additional uploads preserve completed OCR/AI page evidence while invalidating only stale assembled review state.
- Automatic AI verification is used when the provider is configured; local OCR-only remains functional when it is not.
- Multiple active background jobs survive reload through persisted job-to-capture mappings.
- Failed/cancelled captures can be retried without reprocessing completed captures unnecessarily.
- Tickets exposes Capturas, Revisión and Importar; processing feedback is visible in Capturas and Revisión becomes selected when assembly completes.
- No automatic final import occurs.
- Existing queue/concurrency regression tests remain green and new browser coverage proves automatic start and concurrent-upload behavior.

## Tests

- Unit tests for persisted active extraction-job mappings and legacy migration.
- Existing `receipt-ai-concurrency` tests remain authoritative for service queue limits.
- Browser test: upload starts POST `/api/v1/receipts/extraction-jobs` automatically without clicking analysis.
- Browser test: upload another capture while first job is running; first job is not DELETE-cancelled and second job is submitted.
- Browser test: multiple job completions assemble one review only after all captures are completed.
- Browser test: configured AI sends `verifyWithAi: true`; unconfigured provider sends `false`.
- Browser tests retain retry/cancel/reload/import safeguards.
- Run repository quality, Browser E2E, Security, container smoke, amd64/arm64 and CodeQL on final head.

## Rollback

Frontend/state changes are reversible by reverting this task's commits. Persisted job mappings are client-local and backwards compatible with the prior single-job key. No database rollback is required.

## Delivery

- Branch: `agent/ui-android-native-redesign`
- PR: #32
- Conventional atomic commits.
- Merge remains out of scope until explicitly authorized.

## Status

Implementation complete on the feature branch. The delivered flow starts persisted receipt processing immediately after upload, uses the server-owned OCR/AI queues, persists multiple active job-to-capture mappings, restores jobs after reload, supports per-capture retry/cancellation and global cancellation, retains explicit review/validation/import, and removes the former manual analysis step and per-ticket AI toggle.

Regression work on the final PR series also restores the intended recovery boundary: image failures without OCR remain retry-only, while PDFs that cannot produce an OCR draft may still enter blank manual review with the original attachment preserved. Browser coverage was realigned to the automatic flow without weakening the canonical exact-duplicate rule: identical stored captures remain collapsed, while distinct captures remain independent.

Quality, security, CodeQL, container smoke, linux/amd64 and linux/arm64 checks passed on the implementation series. The final documentation head must pass the complete PR CI, including Browser E2E and exact-head visual evidence, before delivery. No merge, release or deployment is authorized by this specification.