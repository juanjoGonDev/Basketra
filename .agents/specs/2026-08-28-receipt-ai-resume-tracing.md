# Receipt AI durable resume and tracing regression

## Request

Fix the post-merge receipt AI regressions observed in production-like use: a reload/restart must continue from persisted OCR and the already-created webApi response instead of restarting OCR or creating replacement AI work, time spent reconciling a known durable remote response must not destroy resumability, and copied diagnostics must correlate the Basketra job with the webApi response/request lifecycle.

## Evidence

- The user observed `AI_RECEIPT_TIMEOUT` for `receiptextractionjob_445a4e342c5a4914a5734ae4af3979a1` after webApi spent several minutes on structured-output correction.
- The merged durable runner already persists OCR per page and reuses it when the same Basketra job resumes.
- `refreshReceiptExtractionJob()` currently clears a failed `AI_*` job and calls `startAutomaticCaptureProcessing(..., { resetAll: true })`; this discards the remembered job identity in the browser and explicitly restarts the client OCR flow.
- Browser page state is volatile across reloads, while the canonical durable OCR evidence lives in Basketra SQLite.
- Each durable page already persists the webApi `resp_*` identity, but that identity is not surfaced in the copied Basketra diagnostic.
- The existing absolute five-minute budget can terminate Basketra while a known webApi response is still running. Recreating OCR/AI after that point would duplicate work and violate the durable contract.

## Decision

- Keep the existing receipt extraction job as the canonical recovery owner. Browser reload/reconnect must read that job; it must never silently replace it with the legacy page-processing pipeline.
- Persist and reuse OCR exclusively through the durable server checkpoint once a background job exists. A reload must not depend on volatile browser `rawText` to recover OCR.
- Once a page has a persisted webApi `responseId`, automatic recovery is GET-only. The original multimodal POST is forbidden.
- A local wait/deadline expiry must not cause automatic OCR or AI replay for a page with a known remote response. Reconciliation of a known durable response may continue/resume without resetting OCR or creating a new response.
- Explicit user retry remains a deliberate new attempt, but it must reuse persisted OCR evidence when safe. It must never be triggered automatically by reload/failure handling.
- Expose bounded, non-sensitive correlation metadata from the public receipt extraction job: Basketra `jobId`, current/relevant webApi `responseId`, and any safe webApi request/correlation identifier available from the remote contract.
- The copyable diagnostic must include those identifiers without receipt text, filenames, filesystem paths, tokens, or provider credentials.
- Keep one owner for remote identifiers in the durable job store/runner. Frontend only renders safe identifiers returned by the server.

## Scope

- Background receipt job recovery after browser reload/reconnect and Basketra restart.
- Durable timeout/reconciliation behavior for pages with a known `resp_*`.
- Explicit retry reuse of persisted OCR where applicable.
- Safe correlation metadata in job responses, errors, logs, and copied diagnostics.
- Regression tests spanning SQLite persistence, server restart, browser reload recovery, timeout boundaries, and diagnostic formatting.

## Out of scope

- Replacing SQLite or the existing receipt extraction job API.
- Persisting receipt image/PDF bytes or OCR text in logs/telemetry.
- Automatic replay of terminal failed webApi executions.
- Changing the user-confirmation boundary for receipt imports.

## Acceptance

- [ ] The spec is the first commit on the PR branch.
- [ ] Reloading the Basketra web UI while a receipt job is active preserves the same `receiptextractionjob_*` and does not POST a replacement job.
- [ ] Restarting Basketra after OCR is persisted causes zero additional OCR calls for those pages.
- [ ] Restarting/reloading with a persisted `resp_*` causes zero additional webApi create calls and reconciles by GET only.
- [ ] An `AI_*` failure no longer clears the job and silently launches `startAutomaticCaptureProcessing(..., { resetAll: true })`.
- [ ] A local five-minute wait boundary cannot trigger automatic replay of OCR or multimodal AI when a durable remote identity is known.
- [ ] Explicit retry is user-driven and reuses server-persisted OCR when safe instead of requiring OCR again.
- [ ] The public job/error contract exposes bounded safe webApi correlation identifiers without sensitive receipt/provider content.
- [ ] `buildReceiptAiDiagnostic()` copies Basketra job ID plus webApi response/request correlation IDs when present.
- [ ] Regression tests reproduce the current reload/failure replay bug and fail before the fix.
- [ ] Real SQLite restart coverage proves OCR call count and remote create call count remain unchanged across recovery.
- [ ] Canonical `pnpm quality`, browser E2E, security and relevant container checks pass without weakening gates.

## Tests

- Browser recovery test: persist an active/failed AI job, reload, assert no legacy OCR queue is started and the same job remains selected.
- Durable runner test: persisted OCR + persisted response identity resumes with `ocr=0`, `create=0`, `get>=1` after restart.
- Timeout regression: known remote response survives the local wait boundary without becoming a replay trigger.
- Retry regression: explicit retry can seed a new attempt from durable OCR evidence but never occurs automatically.
- Diagnostic unit/browser test: copied diagnostic includes safe `jobId` and `webApiResponseId`/correlation ID and rejects unsafe values.

## Risks

- Relaxing the wrong deadline could create unbounded local waiters. Bound each long GET and allow resumable reconciliation rather than one unbounded request.
- Exposing correlation metadata could leak content if fields are not constrained. Only opaque bounded identifiers are allowed.
- Copying OCR to a new explicit retry could create a second source of truth. Reuse the durable store record; do not copy OCR into browser-local persistence.
- Recovery must distinguish a known active remote response from a truly terminal remote failure; terminal failures require explicit user action.

## Rollback

Revert browser recovery, durable runner, and correlation-contract changes together. Additive persistence/API fields may remain tolerated after rollback; never rewrite an applied SQLite migration.

## Delivery

Branch `agent/fix-receipt-ai-resume-tracing`, target `main`. Companion webApi branch `agent/fix-structured-response-finalization`. No merge, release, or deployment without explicit approval.

## Status

Reproduction/evidence confirmed. Implementation and exact-head CI pending.