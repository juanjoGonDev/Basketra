# Receipt AI durable resume and tracing regression

## Request

Fix the post-merge receipt AI regressions observed in production-like use: a reload/restart must continue from persisted OCR and the already-created webApi response instead of restarting OCR or creating replacement AI work, time spent reconciling a known durable remote response must not destroy resumability, copied diagnostics must correlate the Basketra job with the webApi response/request lifecycle, and an explicit retry after a terminal AI failure must remain durable across reloads without depending on volatile browser OCR state.

## Evidence

- The user observed `AI_RECEIPT_TIMEOUT` for `receiptextractionjob_445a4e342c5a4914a5734ae4af3979a1` after webApi spent several minutes on structured-output correction.
- The merged durable runner already persists OCR per page and reuses it when the same Basketra job resumes.
- The previous browser failure path could clear a failed `AI_*` job and fall back to the legacy page-processing pipeline, losing the durable recovery identity.
- Browser page state is volatile across reloads, while the canonical durable OCR evidence lives in Basketra SQLite.
- Each durable page already persists the webApi `resp_*` identity; safe bounded response correlation can therefore be surfaced without exposing receipt content.
- The absolute five-minute local budget must not turn a known durable remote response into an automatic replay trigger.
- The first explicit-retry implementation path still depended on browser `rawText`; after reload that evidence may be absent even though SQLite contains valid OCR.
- Browser E2E exposed an unrelated but real settings race: the AI diagnostic button was re-enabled before its final log refresh completed, allowing overlapping diagnostics and stale status rendering.

## Decision

- Keep the existing receipt extraction job as the canonical recovery owner. Browser reload/reconnect reads that job and must never silently replace it with the legacy page-processing pipeline.
- Persist and reuse OCR exclusively through the durable server checkpoint once a background job exists. A reload does not depend on volatile browser `rawText` to recover OCR.
- Once a page has a persisted webApi `responseId`, automatic recovery is GET-only. The original multimodal POST is forbidden.
- A local wait/deadline expiry does not cause automatic OCR or AI replay for a page with a known remote response. Reconciliation of a known durable response may continue/resume without resetting OCR or creating a new response.
- Explicit user retry creates a new receipt extraction job through the existing `POST /api/v1/receipts/extraction-jobs` contract with `retryOfJobId`; no parallel retry endpoint is introduced.
- The retry source must be a failed durable job whose capture storage keys match the new request. The target receives a fresh deadline and idempotency namespace.
- Retry seeding copies server-persisted OCR for every matching page and completed remote results when safe. Failed/incomplete/cancelled remote identities and old idempotency keys are not copied, so only failed work creates a new `resp_*`.
- Retry seeding is transactional and idempotent so a crash during the handoff cannot create two authoritative checkpoint states.
- Frontend tracks the current failed background job explicitly; a local per-page retry cannot accidentally reuse an unrelated or previously completed durable job.
- Expose bounded, non-sensitive correlation metadata from the public receipt extraction job: Basketra `jobId`, current/relevant webApi `responseId`, and any safe webApi request/correlation identifier available from the remote contract.
- The copyable diagnostic includes those identifiers without receipt text, filenames, filesystem paths, tokens, or provider credentials.
- Keep one owner for remote identifiers in the durable job store/runner. Frontend only renders safe identifiers returned by the server.
- Keep the AI provider diagnostic serialized through its final log refresh; only after finalization completes may the button leave `disabled`/`aria-busy`. Re-check the generation after the awaited refresh so a superseded request cannot reactivate stale UI.

## Scope

- Background receipt job recovery after browser reload/reconnect and Basketra restart.
- Durable timeout/reconciliation behavior for pages with a known `resp_*`.
- Explicit retry reuse of persisted OCR and completed remote results.
- Safe correlation metadata in job responses, errors, logs, and copied diagnostics.
- Regression tests spanning SQLite persistence, server restart, browser reload recovery, timeout boundaries, retry boundaries, and diagnostic formatting.
- Deterministic serialization of the settings AI diagnostic while its final log refresh is in flight.

## Out of scope

- Replacing SQLite or the existing receipt extraction job API.
- Persisting receipt image/PDF bytes or OCR text in logs/telemetry.
- Automatic replay of terminal failed webApi executions.
- Changing the user-confirmation boundary for receipt imports.
- Weakening Browser E2E, quality, security, coverage, or container gates to accommodate flakes.

## Acceptance

- [x] The spec is the first commit on the PR branch.
- [x] Reloading the Basketra web UI while a receipt job is active preserves the same `receiptextractionjob_*` and does not POST a replacement job.
- [x] Restarting Basketra after OCR is persisted causes zero additional OCR calls for those pages.
- [x] Restarting/reloading with a persisted `resp_*` causes zero additional webApi create calls and reconciles by GET only.
- [x] An `AI_*` failure no longer clears the job and silently launches the legacy OCR pipeline.
- [x] A local five-minute wait boundary cannot trigger automatic replay of OCR or multimodal AI when a durable remote identity is known.
- [x] Explicit retry is user-driven and reuses server-persisted OCR instead of requiring browser-local OCR state.
- [x] Explicit retry reuses completed remote results but never reuses failed response identities or prior idempotency keys.
- [x] Retry source/target captures are validated before durable evidence is copied.
- [x] The public job/error contract exposes bounded safe webApi correlation identifiers without sensitive receipt/provider content.
- [x] `buildReceiptAiDiagnostic()` copies Basketra job ID plus safe webApi response/request correlation identifiers when present.
- [x] Regression tests reproduce the reload/failure replay and explicit retry gaps.
- [x] Real SQLite coverage proves OCR call count and remote create call count remain unchanged across automatic recovery.
- [x] Explicit retry coverage proves persisted OCR causes `ocr=0` and only failed pages create new remote work.
- [x] Provider diagnostic UI remains serialized until final log refresh completes and ignores stale generations.
- [ ] Canonical `pnpm quality`, Browser E2E, CodeQL/security and relevant container checks pass on the final exact head without weakening gates.

## Tests

- Browser recovery: persist an active/failed AI job, reload, assert no legacy OCR queue is started and the same job remains selected.
- Durable runner: persisted OCR + persisted response identity resumes with `ocr=0`, `create=0`, `get>=1` after restart.
- Timeout regression: known remote response survives the local wait boundary without becoming a replay trigger.
- Retry store/runner: seed a new job from a failed source; assert all OCR is reused, completed remote results are reused, failed `resp_*` is not copied, and only the failed page creates a new remote response under the target job idempotency namespace.
- Retry API: create a failed durable source through SQLite, POST a new extraction job with `retryOfJobId`, assert a distinct job is returned and its durable checkpoint contains server OCR rather than browser-provided OCR.
- Diagnostic unit/browser coverage: copied diagnostic includes safe `jobId` and webApi response/request correlation identifiers and rejects unsafe values.
- Settings Browser E2E: block final `/api/v1/logs` refresh and assert the AI diagnostic button remains disabled/busy until finalization completes.

## Risks

- Relaxing the wrong deadline could create unbounded local waiters. Bound each long GET and allow resumable reconciliation rather than one unbounded request.
- Exposing correlation metadata could leak content if fields are not constrained. Only opaque bounded identifiers are allowed.
- Copying OCR to a new explicit retry could create a second source of truth. Reuse the durable SQLite store record; never copy OCR into browser-local persistence as authority.
- Reusing a completed remote result for mismatched captures would be unsafe. Retry creation validates ordered storage keys/page count before seeding.
- Recovery must distinguish a known active remote response from a truly terminal remote failure; terminal failures require explicit user action.
- Async settings finalization can race with a programmatic superseding diagnostic; generation checks remain authoritative before and after the final awaited refresh.

## Rollback

Revert browser recovery, durable retry, runner and correlation-contract changes together. Additive persistence/API fields may remain tolerated after rollback; never rewrite an applied SQLite migration. The settings diagnostic serialization fix is independent and may remain if the receipt changes are rolled back.

## Checks

- `CodeQL Advanced` passed on intermediate retry head `a5cadbf2776340450ef13d7a901b81d3d42e4206`.
- Security, amd64/arm64 container builds and container smoke passed on that same intermediate head.
- Quality on that head identified only a missing final newline in `src/receipts/service.ts`; fixed by `de546fcd7a7d6f2650b4f3d27d7edce455d240fb` without gate changes.
- Browser E2E on that head passed 51/52 and exposed the provider-diagnostic finalization race; regression coverage was added before the production fix, and the production fix is `441b97054c93021d2415d27f2bc8faea9c145917`.
- Final authority is the normal PR workflow suite on the exact final head after this documentation commit.

## Delivery

Branch `agent/fix-receipt-ai-resume-tracing`, target `main`. Companion webApi branch `agent/fix-structured-response-finalization`. No merge, release, or deployment without explicit approval.

## Status

Implementation, durable retry, correlation coverage, retry API coverage, and settings diagnostic race fix are complete. Final exact-head PR CI is pending; no merge, release, or deployment has been performed.
