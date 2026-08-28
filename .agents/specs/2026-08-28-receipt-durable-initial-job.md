# Initial durable receipt job recovery

## Request

Fix the receipt workflow so reloading Basketra after processing an already-uploaded capture never replays OCR or AI automatically. The initial processing run must create and persist one durable extraction job identity immediately, and subsequent browser reloads must recover that job and its SQLite checkpoints instead of reconstructing work from volatile browser page state.

The receipt AI lane must also remain serialized: at most one non-terminal remote AI response may be active at a time.

## Evidence

- `receipt-state.js` loads `basketra.receiptExtractionJobId` from localStorage into `state.activeJobId`, and `initReceipts()` correctly prefers recovering that job when the ID exists.
- The original automatic AI path ran browser-owned `/api/v1/receipts/extract` OCR before creating a per-page AI job, and the returned job ID was not persisted as the receipt processing owner.
- `page.rawText` and `page.result` are browser-memory fields; capture persistence contains file metadata, not OCR/model output.
- The server already owns `ReceiptDurableJobStore`, including per-page `ocr_json`, remote response identity/status/result, restart recovery, and `saveOcrPage()`.
- The legacy browser page pool has concurrency two, which is appropriate for the non-AI local OCR workflow but previously allowed the AI-enabled automatic path to enter that two-slot flow.
- A capture draft can outlive browser localStorage job identity, so recovery must also be able to adopt a durable server job created by the previous broken flow without uploading the file again.

## Decision

- The AI-enabled automatic receipt flow uses one server-side extraction job as the canonical owner for the whole ordered capture set.
- The browser persists the returned `receiptextractionjob_*` before waiting for completion or subscribing to invalidations.
- OCR, remote `resp_*` identity, remote status and accepted output checkpoints remain server-owned in SQLite; the browser does not duplicate OCR/model output into localStorage.
- Browser reload with a known job performs GET/realtime recovery only. It does not call `/api/v1/receipts/extract`, create a replacement extraction job, or restart the page queue.
- Browser reload with persisted captures but no local job identity first calls the recovery endpoint. The server adopts only a durable AI job whose ordered `storageKey` list matches the current draft exactly. Cancelled jobs and reordered/different capture sets are not adopted.
- Recovery fails closed. A recovery transport failure, malformed recovered identity, or initial status-read failure must not become permission to start duplicate OCR/AI work. A valid adopted identity remains persisted even if its first status read fails.
- The receipt Responses client serializes remote AI creation/reconciliation so at most one non-terminal receipt AI response is active at a time.
- Explicit retry after a durable AI failure creates a new job from server-persisted OCR. Completed materialized results may be reused, but the original `resp_*` remains owned by its original job.
- Explicit capture-set mutation invalidates the previous durable identity. Reorder/delete clears the browser job association and requests cancellation of the old job; passive reload never does so.
- The legacy two-slot page queue remains available for AI-disabled local OCR and narrowly scoped local recovery, but it is not the AI-enabled automatic owner.

## Scope

- Initial receipt job creation and browser persistence.
- Reload/startup recovery routing, including adoption of a previously orphaned durable job.
- Automatic upload processing path.
- Serialized remote receipt AI execution.
- Durable retry/cancel behavior.
- Capture-set mutation invalidation.
- Integration and browser tests proving zero OCR/AI replay across reload/restart.

## Risks

- Switching the initial owner can expose assumptions in UI page-status rendering that depended on local per-page OCR state.
- A crash between server job creation and browser persistence can orphan a job; exact-capture recovery closes that gap without matching approximately.
- Capture mutations must not reuse a job created for a different ordered capture set.
- Recovery lookup availability must not cause duplicate work; therefore recovery fails closed instead of treating lookup failure as “not found”.
- AI-disabled behavior remains on the local OCR path and must not be described as server-durable when it is not.

## Acceptance

- [x] This spec is the first commit on the branch.
- [x] Uploading an image and starting AI-enabled automatic analysis persists one `receiptextractionjob_*` before asynchronous reconciliation.
- [x] The AI-enabled automatic path no longer performs browser-owned OCR followed by a separate orphan AI job.
- [x] Reload while the durable job is queued/running keeps the same job ID and performs zero replacement job POSTs.
- [x] Reload after OCR has been checkpointed performs zero additional OCR calls for that page.
- [x] Reload with a persisted `resp_*` performs GET/reconciliation only and creates zero additional remote AI responses.
- [x] Reload after terminal completion restores the completed extraction/review and performs zero OCR/AI work.
- [x] Reload after terminal AI failure restores the failed durable job and diagnostics without automatic replay.
- [x] Stored captures with a missing browser job ID adopt only the exact ordered durable server job before any new OCR/AI is permitted.
- [x] Recovery failures and malformed recovered identities fail closed without creating OCR or AI work.
- [x] Receipt AI execution permits at most one non-terminal remote response at a time.
- [x] Explicit AI retry reuses server-persisted OCR and does not steal the original job's `resp_*` identity.
- [x] Explicit capture reorder/delete invalidates the durable identity associated with the previous ordered draft; passive reload does not.
- [x] The browser does not persist OCR text or model output in localStorage.
- [x] Diagnostics retain Basketra job ID and available webApi `resp_*` correlation.
- [x] Regression tests cover browser reload with the same previously uploaded capture, not a newly uploaded replacement.
- [x] Format, lint, typecheck, unit/integration, browser E2E, security, coverage, CodeQL, and container/production checks pass for the implementation head before documentation-only finalization.

## Tests

- Browser initial creation: AI-enabled upload creates one whole-ticket job, persists its ID, and performs zero browser `/receipts/extract` calls.
- Browser reload: same stored capture + known job ID => same job, zero replacement POSTs and zero OCR replay.
- Browser orphan adoption: same stored capture + missing local job ID + exact durable server job => adopt existing job and create zero work.
- Browser recovery boundaries: lookup failure, malformed recovered ID and first status-read failure all remain fail-closed.
- Browser terminal recovery: completed/failed durable jobs restore review/recovery state without automatic replay.
- Browser capture mutation: reorder and delete clear/cancel the durable identity bound to the previous ordered draft.
- SQLite adoption: exact ordered capture identity is required, active work is preferred, and cancelled/reordered jobs are excluded.
- Server recovery API: exact ordered captures recover the durable job; reversed order returns no adoption.
- Integration restart: persisted OCR checkpoint + same capture/job => OCR calls 0.
- Integration remote recovery: persisted `resp_*` + same capture/job => create calls 0, GET calls >= 1.
- Remote concurrency: concurrent receipt AI callers observe at most one non-terminal remote response.
- Durable retry: server OCR and completed materialized results are reused without transferring `resp_*` ownership.

## Checks

Implementation head `6b547d84a363205f8ef3be14e732fba35c4dad42`:

- Pull Request Quality #845 (`33204752280`) passed Quality, Security, Browser E2E, AMD64, ARM64 and container smoke jobs.
- Quality passed format, lint, `tsc --noEmit`, dead-code/dependency policy, 198/198 unit tests, 45/45 integration tests, production build and resource budgets.
- Browser E2E passed the durable reload, orphan adoption, fail-closed recovery and capture mutation regressions with changed-code coverage enforced.
- CodeQL Advanced #773 (`33204752274`) passed.
- Visual-evidence classification and publication jobs for run #723 (`33204752272`) passed for the implementation head.

Normal exact-head CI remains the delivery authority for documentation-only finalization commits; no production code changes follow this specification closeout.

## Rollback

Revert the frontend ownership/recovery switch and its tests together. Do not rewrite applied SQLite migrations or delete durable checkpoints. The recovery endpoint/store lookup is additive and can be reverted without mutating persisted jobs. Reverting serialization would restore the previous remote-concurrency risk and is not recommended independently.

## Delivery

Branch `agent/fix-receipt-durable-initial-job`, target `main`. No merge, release, deployment, publication, or destructive data operation without explicit approval.

## Status

Complete. The implementation, recovery boundaries, single-AI concurrency contract and capture-mutation invalidation are covered by automated tests. No production code changes follow this specification closeout.
