# Receipt AI background-job recovery

## Request

Investigate receipt OCR/AI correction still failing around 90–100 seconds even though Basketra now owns a five-minute receipt AI budget. Make the long-running AI correction resilient to public HTTP/reverse-proxy connection limits, and expose a safe copyable diagnostic when an AI correction fails.

## Evidence

- Production logs repeatedly show public `POST /api/v1/receipts/extract` requests failing near 90,000 ms with `http.inner_unreachable` / `INNER_UNREACHABLE` followed by client 504 responses.
- `OperationsGateway.proxy()` has no 90-second timeout. It destroys the inner request when the outer response closes; the resulting upstream error is then logged as `http.inner_unreachable`. Therefore `INNER_UNREACHABLE` can be a secondary symptom of an external/public connection closing rather than proof that the inner Basketra service died.
- Before this change, the ticket UI called synchronous `POST /api/v1/receipts/extract` for AI correction through `requestExtraction(..., true, signal)`.
- Basketra already owns a durable asynchronous extraction API: `POST /api/v1/receipts/extraction-jobs`, `GET /api/v1/receipts/extraction-jobs/:id`, `DELETE /api/v1/receipts/extraction-jobs/:id`, plus realtime `receipt-extraction-job` invalidations.
- Background extraction jobs have an independent server-side `AbortController`; they are not tied to the lifetime of the short POST that creates the job.
- Repository policy forbids polling. The existing realtime EventSource remains the completion signal, with status refresh on initial observation, reconnect, and matching invalidation so missed events do not strand the UI.
- The five-minute receipt AI budget from PR #36 remains canonical inside `ReceiptExtractionService`; this task changes transport/lifecycle, not the product deadline.

## Decision

1. Local OCR and deterministic assembly keep using synchronous `/api/v1/receipts/extract` because they are local/short-lived.
2. Any `verifyWithAi: true` correction initiated by the ticket UI uses the asynchronous extraction-job API instead of holding one public HTTP request open for the whole model operation.
3. Job creation returns quickly. The client observes completion through the existing realtime EventSource and performs bounded status reads on initial observation, reconnect, and matching invalidations. No interval polling is introduced.
4. EventSource disconnect/reconnect does not cancel the server job. Reconnect refreshes job state so a completion that occurred while disconnected is recovered.
5. User cancellation never replays the original AI request. If cancellation races with job creation, the creation response is allowed to reveal the canonical job id and one best-effort DELETE is issued for that job.
6. Terminal job failure is surfaced with its canonical `errorCode` and safe `jobId`. Receipt/OCR content, original filenames, attachment bytes, provider response bodies, filesystem paths, credentials, cookies, and API keys are excluded from diagnostics.
7. AI failure UI exposes one `Copiar diagnóstico` action. Copied text is allowlisted to the bounded `AI_*` code plus safe job/request identifiers and a valid HTTP error status when available.
8. The existing retry button starts a new explicit user-requested AI correction using the preserved OCR. Automatic replay remains forbidden.
9. The legacy persisted full-receipt background-job recovery path remains supported; no second authoritative job schema is introduced.

## Scope

- `src/web/receipt-lifecycle.js`: async AI job creation/waiter using realtime invalidation, reconnect refresh, and cancellation-safe cleanup.
- `src/web/receipt-ai-recovery.js`: single owner for redacted AI recovery guidance and copyable diagnostic construction.
- `src/web/receipt-capture.js`: render/copy the safe diagnostic action.
- `src/web/api.js`: preserve safe request-id metadata on thrown API errors when available.
- Focused browser/unit tests for asynchronous transport, reconnect, cancellation races, multipage OCR payloads, and diagnostic redaction.
- No webApi change, database migration, provider schema change, secret change, deployment, or release.

## Risks

- EventSource may disconnect under the same public proxy; reconnect is recovery, not failure.
- A completion can happen between job creation and EventSource observation. The immediate status refresh closes this race.
- A completion can happen while EventSource is disconnected. Refresh-on-open closes this race.
- Multiple receipt pages can run concurrently. Each AI waiter owns only its own job/EventSource and does not overwrite the legacy global `state.activeJobId` recovery slot.
- Cancellation during the job-creation response race must not leave an orphaned server job or issue a second AI request.
- Diagnostic UX must not become a path for receipt or provider-data leakage.

## Tests

- Prove AI correction does not call synchronous `/api/v1/receipts/extract` with `verifyWithAi: true`.
- Prove AI correction creates an extraction job and resolves from terminal job state while the initial POST remains short-lived.
- Prove reconnect/open refresh recovers a job that completed while realtime was disconnected without interval polling.
- Prove cancellation during job creation deletes the returned job exactly once and does not replay the original AI request.
- Prove a failed job surfaces its canonical code and job id.
- Prove copied diagnostic includes only bounded correlation metadata and excludes OCR text, filename, attachment/storage identifiers, and provider payload content.
- Prove multipage AI jobs receive the OCR text belonging to their own page rather than a retailer-specific fixture assumption.
- Preserve existing OCR concurrency, manual review, replay-safety, five-minute receipt budget, retailer autofill, and legacy persisted-job recovery tests.
- Run `pnpm quality` and all PR CI gates on the exact delivery head.

## Acceptance

- [x] Ticket AI correction no longer depends on one long-lived public `/receipts/extract` request.
- [x] External/public connection closure cannot cancel a server-side AI extraction job merely by closing the creator request.
- [x] No interval polling is introduced.
- [x] Realtime reconnect recovers missed terminal state.
- [x] User cancellation cancels the correct server job and does not replay the original request.
- [x] Five-minute Basketra receipt budget remains unchanged.
- [x] Safe copyable diagnostics are available on AI failure.
- [x] Diagnostics contain no receipt/provider sensitive payloads.

Exact-head CI is an external delivery gate owned by the PR checks; the current PR head must be green before delivery is considered complete.

## Rollback

Revert the frontend async-job transport and diagnostic commits. The server job API and database schema already exist, so no migration rollback is required.

## Delivery

Branch `agent/fix-receipt-ai-background-job` targeting `main`. Do not merge, release, publish, deploy, modify secrets, change protected branches, or mutate production data without explicit approval.

## Status

Implementation and regression coverage are complete. The synchronous public request dependency has been removed from ticket AI correction, cancellation/reconnect races are covered, and diagnostics are bounded/redacted. Final delivery status is determined by the PR checks on the exact current head.
