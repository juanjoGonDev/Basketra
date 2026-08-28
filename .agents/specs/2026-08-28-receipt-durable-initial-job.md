# Initial durable receipt job recovery

## Request

Fix the receipt workflow so reloading Basketra after processing an already-uploaded capture never replays OCR or AI automatically. The initial processing run must create and persist one durable extraction job identity immediately, and subsequent browser reloads must recover that job and its SQLite checkpoints instead of reconstructing work from volatile browser page state.

## Evidence

- `receipt-state.js` loads `basketra.receiptExtractionJobId` from localStorage into `state.activeJobId`, and `initReceipts()` correctly prefers recovering that job when the ID exists.
- When `state.activeJobId` is empty but persisted captures exist, `initReceipts()` calls `startAutomaticCaptureProcessing(state.captures)`, which starts OCR again.
- The normal upload path currently calls `startAutomaticCaptureProcessing()` and the client page queue performs `/api/v1/receipts/extract` OCR before optional AI correction.
- `runAiCorrection()` then calls `requestExtraction(..., true)`. `requestAiExtractionJob()` creates `/api/v1/receipts/extraction-jobs`, receives a `jobId`, but does not assign it to `state.activeJobId` or persist it with `saveReceiptExtractionJobId()`.
- `page.rawText` and `page.result` are browser-memory fields. `persistAndRenderCaptures()` persists capture metadata only, not OCR/result checkpoints.
- The server already owns `ReceiptDurableJobStore`, including per-page `ocr_json`, remote response identity/status/result, restart recovery, and `saveOcrPage()`.
- Therefore the merged recovery work protects jobs that the browser already knows about, but the normal initial receipt flow does not establish that durable identity as its processing owner. Reloading loses the browser-only OCR state and starts the legacy OCR/AI pipeline again.

## Decision

- The automatic initial receipt flow will use one server-side extraction job as the canonical owner for the whole capture set.
- The browser must persist the returned `receiptextractionjob_*` before waiting for completion or subscribing to invalidations.
- With AI verification enabled, OCR and AI checkpoints remain server-owned in SQLite through `ReceiptDurableJobStore`; the browser does not duplicate OCR into localStorage.
- Browser reload with a known job performs GET/realtime recovery only. It must not call `/api/v1/receipts/extract`, create a replacement extraction job, or restart the page queue.
- Browser reload with persisted captures but no job may start a new job only when there is no recoverable durable identity for that capture draft. The implementation must make normal initial processing establish the identity before asynchronous work can be lost.
- Explicit user actions that change the capture set may cancel/replace the previous job. Passive reload must never do so.
- The legacy per-page OCR queue may remain for narrowly-scoped manual/recovery interactions only if it is no longer the automatic initial owner and cannot silently replay an already-started durable job.

## Scope

- Initial receipt job creation and browser persistence.
- Reload/startup recovery routing.
- Automatic upload processing path.
- Integration tests proving zero OCR/AI replay across reload/restart.
- Existing explicit retry/cancel behavior where it interacts with the new owner.

## Risks

- Switching the initial owner can expose assumptions in UI page-status rendering that currently depend on local per-page OCR state.
- A crash between server job creation and browser persistence could still orphan a job unless the creation response/persistence boundary is tested and the server contract remains idempotent where applicable.
- Capture mutations must not accidentally reuse a job created for a different ordered capture set.
- AI-disabled behavior must remain usable; if non-AI jobs are not durable today, the implementation must not falsely claim restart durability for them.

## Acceptance

- [x] This spec is the first commit on the branch.
- [ ] Uploading an image and starting automatic analysis persists one `receiptextractionjob_*` immediately.
- [ ] The initial automatic path no longer performs browser-owned OCR followed by a separate orphan AI job when AI verification is enabled.
- [ ] Reload while the durable job is queued/running keeps the same job ID and performs zero replacement job POSTs.
- [ ] Reload after OCR has been checkpointed performs zero additional OCR calls for that page.
- [ ] Reload with a persisted `resp_*` performs GET/reconciliation only and creates zero additional remote AI responses.
- [ ] Reload after terminal completion restores the completed extraction/review and performs zero OCR/AI work.
- [ ] Reload after terminal AI failure restores the failed durable job and diagnostics without automatic replay.
- [ ] Changing the capture set explicitly invalidates/replaces only the affected processing identity; passive reload does not.
- [ ] The browser does not persist OCR text or model output in localStorage.
- [ ] Diagnostics retain Basketra job ID and available webApi `resp_*` correlation.
- [ ] Regression tests cover browser reload with the same previously uploaded capture, not a newly uploaded file.
- [ ] Format, lint, typecheck, unit/integration, browser E2E, security, coverage, and container/production checks pass on the final exact head.

## Tests

- Browser/startup contract: stored captures + stored job ID => recover existing job only.
- Initial creation contract: job ID is persisted before asynchronous waiting/realtime recovery begins.
- Integration restart: persisted OCR checkpoint + same capture/job => OCR calls 0.
- Integration remote recovery: persisted `resp_*` + same capture/job => create calls 0, GET calls >= 1.
- Completed reload: no processing calls and review restored from job output.
- Failed reload: no processing calls and durable recovery action/diagnostic restored.
- Capture replacement: explicit upload/change creates a new job and never associates the previous checkpoint with different evidence.

## Rollback

Revert the frontend ownership switch and its tests together. Do not rewrite applied SQLite migrations or delete durable checkpoints. If a server change is required, keep rollback additive and compatible with existing persisted jobs.

## Delivery

Branch `agent/fix-receipt-durable-initial-job`, target `main`. No merge, release, deployment, publication, or destructive data operation without explicit approval.

## Status

Regression reproduced from current `main` (`204099adace431880105d5e8c6ae243cfc5757a6`). Implementation pending.
