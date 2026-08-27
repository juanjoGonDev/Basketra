# Receipt AI background-job recovery

## Request

Investigate receipt OCR/AI correction still failing around 90–100 seconds even though Basketra now owns a five-minute receipt AI budget. Make the long-running AI correction resilient to public HTTP/reverse-proxy connection limits, and expose a safe copyable diagnostic when an AI correction fails.

## Evidence

- Production logs repeatedly show public `POST /api/v1/receipts/extract` requests failing near 90,000 ms with `http.inner_unreachable` / `INNER_UNREACHABLE` followed by client 504 responses.
- `OperationsGateway.proxy()` has no 90-second timeout. It destroys the inner request when the outer response closes; the resulting upstream error is then logged as `http.inner_unreachable`. Therefore `INNER_UNREACHABLE` can be a secondary symptom of an external/public connection closing rather than proof that the inner Basketra service died.
- The current ticket UI still calls synchronous `POST /api/v1/receipts/extract` for AI correction through `requestExtraction(..., true, signal)`.
- Basketra already owns a durable asynchronous extraction API: `POST /api/v1/receipts/extraction-jobs`, `GET /api/v1/receipts/extraction-jobs/:id`, `DELETE /api/v1/receipts/extraction-jobs/:id`, plus realtime `receipt-extraction-job` invalidations.
- Background extraction jobs have an independent server-side `AbortController`; they are not tied to the lifetime of the short POST that creates the job.
- Repository policy forbids polling. The existing realtime EventSource must remain the completion signal, with a status refresh on initial subscription/reconnect so missed invalidations do not strand the UI.
- The five-minute receipt AI budget from PR #36 remains canonical inside `ReceiptExtractionService`; this task changes transport/lifecycle, not the product deadline.

## Decision

1. Local OCR and deterministic assembly may keep using synchronous `/api/v1/receipts/extract` because they are local/short-lived.
2. Any `verifyWithAi: true` correction initiated by the ticket UI must use the asynchronous extraction-job API instead of holding one public HTTP request open for the whole model operation.
3. Job creation returns quickly. The client observes completion through the existing realtime EventSource and performs bounded status reads on initial subscription, reconnect, and matching invalidations. Do not add interval polling.
4. EventSource disconnect/reconnect must not cancel the server job. Reconnect must refresh job state so a completion that occurred while disconnected is recovered.
5. User cancellation aborts the local waiter, closes its EventSource, and sends one best-effort DELETE for the active job. It must not start another AI request.
6. Terminal job failure is surfaced with its canonical `errorCode` and safe `jobId`. Receipt/OCR content, original filenames, attachment bytes, provider response bodies, filesystem paths, credentials, cookies, and API keys must never be included in diagnostics.
7. AI failure UI exposes one `Copy diagnostic` action. Copied text contains only safe correlation fields such as timestamp, error code, HTTP status when available, job/request id, elapsed duration, and application version/revision when available.
8. The existing retry button continues to start a new explicit user-requested AI correction using the preserved OCR. Automatic replay remains forbidden.
9. The legacy persisted full-receipt background-job recovery path remains supported; do not create a second authoritative job schema.

## Scope

- `src/web/receipt-lifecycle.js`: async AI job waiter using realtime invalidation, reconnect refresh, cancellation.
- `src/web/receipt-processing.js`: retain safe diagnostic metadata on page AI failure.
- `src/web/receipt-state.js`: canonical per-page diagnostic state.
- `src/web/receipt-capture.js`: render/copy safe diagnostic action.
- `src/web/api.js`: preserve safe request-id metadata on thrown API errors when available.
- Focused browser/integration tests for the async transport, reconnect, cancellation, and diagnostic redaction.
- No webApi change, database migration, provider schema change, secret change, deployment, or release.

## Risks

- EventSource may disconnect under the same public proxy; reconnect must be recovery, not failure.
- A completion can happen between job creation and EventSource subscription. The immediate status refresh closes this race.
- A completion can happen while EventSource is disconnected. Refresh-on-open closes this race.
- Multiple receipt pages can run concurrently. Each AI waiter must own only its own job/EventSource and must not overwrite the legacy global `state.activeJobId` recovery slot.
- Cancellation must be idempotent and best-effort without converting a completed job into a user-visible failure.
- Diagnostic UX must not become a path for receipt or provider-data leakage.

## Tests

- Reproduce the current contract: AI correction must not call synchronous `/api/v1/receipts/extract` with `verifyWithAi: true`.
- Prove AI correction creates an extraction job and resolves from a terminal job state while the initial POST remains short-lived.
- Prove a running job completes after a realtime invalidation.
- Prove reconnect/open refresh recovers a job that completed while realtime was disconnected.
- Prove cancellation closes observation and issues one DELETE without retrying the original AI request.
- Prove a failed job surfaces its canonical code and job id.
- Prove copied diagnostic includes safe correlation metadata and excludes OCR text, filename, attachment identifiers, and provider payload content.
- Preserve existing OCR concurrency, manual review, replay-safety, five-minute receipt budget, and legacy persisted-job recovery tests.
- Run `pnpm quality` and all PR CI gates on the exact head.

## Acceptance

- [ ] Ticket AI correction no longer depends on one long-lived public `/receipts/extract` request.
- [ ] External/public connection closure cannot cancel a server-side AI extraction job merely by closing the creator request.
- [ ] No interval polling is introduced.
- [ ] Realtime reconnect recovers missed terminal state.
- [ ] User cancellation cancels the correct server job and does not replay the original request.
- [ ] Five-minute Basketra receipt budget remains unchanged.
- [ ] Safe copyable diagnostics are available on AI failure.
- [ ] Diagnostics contain no receipt/provider sensitive payloads.
- [ ] Exact-head CI passes.

## Rollback

Revert the frontend async-job transport and diagnostic commits. The server job API and database schema already exist, so no migration rollback is required.

## Delivery

Branch `agent/fix-receipt-ai-background-job` targeting `main`. Do not merge, release, publish, deploy, modify secrets, change protected branches, or mutate production data without explicit approval.

## Status

Root cause is narrowed to a fragile synchronous public transport path: the observed ~90-second public connection cutoff destroys the gateway's inner request, which is then misreported as `INNER_UNREACHABLE`. Implementation and regression coverage are pending.