# Durable receipt AI reconciliation

## Request
Persist receipt OCR and downstream webApi execution identity on the Basketra server so browser reloads, reconnects and Basketra restarts reconcile existing work instead of repeating OCR or resubmitting the receipt image.

## Evidence
- Basketra already persists `receipt_extraction_jobs`, but schema v5 stores only the original request, final result/error and timestamps.
- `ReceiptExtractionService.extract()` currently performs OCR and AI verification in one process lifetime and keeps per-page OCR evidence only in memory.
- AI verification is sequential per receipt page and shares one receipt affinity; a durable design must preserve page order and must not turn recovery into parallel duplicate model submissions.
- `BasketraServer.listen()` currently calls `recoverInterruptedReceiptExtractionJobs()`, converting queued/running work to terminal `RECEIPT_EXTRACTION_INTERRUPTED` on every process start.
- `BasketraServer.close()` currently marks every active extraction job failed before aborting the local controller.
- The browser already uses the asynchronous extraction-job API plus realtime invalidation/status refresh.
- webApi replay safety prevents known post-progress duplicate turns, but Basketra still needs durable remote execution reconciliation across process/browser lifetime boundaries.
- Companion webApi PR #104 implements a durable Responses-compatible resource with `POST /v1/responses`, `GET /v1/responses/:responseId`, cancellation and `Idempotency-Key` reconciliation.

## Scope
- Extend the existing receipt extraction job persistence and orchestration only; do not add a competing job table or second receipt pipeline.
- Preserve the public extraction-job API/status contract where practical. Durable internal phase/page state may be richer than the existing public status.
- Cover image and PDF/multimodal verification through the same durable remote execution contract.
- Keep the existing receipt AI five-minute budget, but make it an absolute persisted deadline so restart/reload cannot reset it.
- Browser reload/reconnect is read/reconciliation only. It never creates a new job, repeats OCR or creates a second remote model execution.
- Explicit user retry is the only operation allowed to start a new generation after a terminal recoverable failure.

## Decision
- Keep `receipt_extraction_jobs` as the single Basketra owner; extend it with an additive migration v6 rather than rewriting migration v5.
- Persist an absolute `deadlineAt` when the AI job is created. Reload/restart never resets the five-minute Basketra receipt-AI budget.
- Persist OCR/deterministic page evidence before starting remote AI verification.
- Persist durable per-page state so already completed OCR and remote AI pages are reused after restart.
- Persist a deterministic generation-specific idempotency key before creating each remote webApi execution.
- Persist the returned webApi `responseId` immediately and reconcile it with GET status calls.
- `ai_pending` without a remote ID may repeat create only with the already persisted idempotency key, allowing a lost create response to resolve to the same remote execution.
- Once a page has a `responseId`, automatic recovery performs GET only; it never reconstructs or replays the original multimodal POST.
- Persist each completed remote result into Basketra before advancing to the next page. A locally copied result is authoritative for recovery even after webApi retention removes the remote response.
- A missing/expired/interrupted remote response before Basketra copied its result becomes a recoverable terminal job failure. Automatic replay is forbidden; explicit user retry creates a new generation/key.
- Startup resumes recoverable queued/OCR/AI jobs instead of marking them interrupted. Shutdown aborts only local waiters/controllers and preserves durable recoverable state unless the user explicitly cancelled the job.
- Cancellation remains explicit. A cancelled local job may cancel its known remote response; cancellation never creates another model turn.
- Deleting/pruning a terminal job removes its durable transient page state according to the existing extraction-job retention lifecycle.

## State model
Public job status remains compatible with the existing extraction-job API. Internally the durable phase is:

`queued -> ocr_running -> ai_pending -> ai_running -> completed | failed | cancelled`

Per-page remote state is:

`pending -> creating -> remote_running -> completed | failed`

Rules:
- `ocr_running` may execute OCR only for pages without persisted OCR evidence.
- `ai_pending` without a remote ID may POST only with its persisted generation/page idempotency key.
- `ai_running` with a remote ID may only reconcile by GET.
- A persisted remote result is consumed locally without another POST or GET requirement.
- Restart recovery never increments generation.
- Explicit retry increments generation and clears only generation-scoped remote state; original captures remain the same input evidence.

## Persistence model
Migration v6 should add durable job metadata without storing duplicate image bytes:
- job generation;
- durable phase;
- absolute AI deadline;
- persisted OCR/deterministic page evidence;
- per-page idempotency key;
- per-page webApi `responseId`;
- per-page remote status/result/error needed for recovery.

Stored file `storageKey` remains the canonical owner of receipt image bytes. Durable job state references it; it does not copy image bytes into SQLite.

## Remote contract
Basketra consumes the companion webApi Responses subset:
- create: `POST /v1/responses` with `background: true`, `store: true`, structured `text.format`, multimodal input and a persisted `Idempotency-Key`;
- reconcile: `GET /v1/responses/:responseId` with bounded `Prefer: wait=N` when useful;
- cancel: `POST /v1/responses/:responseId/cancel` only for explicit local cancellation.

The create request is generation/page deterministic. A network loss before Basketra receives the create response may cause the same create request to be sent again with the same key; webApi must return the same `resp_*` and execute the model once.

## Tests
Deterministic tests must prove at minimum:
- restart/reload after persisted OCR causes zero additional OCR calls;
- lost create response repeats create with the same key and results in one remote model execution;
- once `responseId` is persisted, connection loss/restart performs GET only and original multimodal POST count stays one;
- remote completion while Basketra is offline is reconciled and copied locally;
- a copied page result survives remote response expiry;
- remote 404/expiry/interruption before local copy fails recoverably without automatic POST replay;
- multi-page recovery preserves order and does not duplicate completed pages;
- the original absolute five-minute deadline remains unchanged across restart;
- process shutdown does not convert recoverable work to terminal failure;
- explicit user cancellation cancels only the known job/remote response;
- explicit retry increments generation and creates exactly one new remote execution;
- existing replay-safety tests continue to prove pre-progress retries remain legal and post-progress original request replay is forbidden.

Cross-service contract coverage must count both Basketra create requests and attachment/model executions. The original multimodal model execution must occur exactly once per page/generation even when the create HTTP response is lost.

## Risks
- Crash window between remote create and persisting `responseId`: mitigated by persisting the idempotency key first and repeating only the identical create request/key.
- Crash window between remote completion and local result persistence: reconcile by GET using the persisted `responseId`; do not replay.
- Remote retention may remove a completed response before local copy: report recoverable terminal failure; do not infer that replay is safe.
- Persisted OCR/result JSON can increase SQLite usage: reuse existing job retention and keep fields bounded; never persist attachment bytes in the job row.
- Multi-page receipts can accidentally duplicate work if recovery is implemented at whole-receipt granularity: page state is therefore persisted independently while orchestration remains sequential.
- Existing browser API consumers must not need to understand internal durable phases to continue showing queued/running/completed/failed/cancelled states.

## Acceptance
- [ ] Additive migration v6 extends existing receipt extraction jobs; migration v5 is untouched.
- [ ] OCR page evidence is persisted before remote AI creation.
- [ ] Reload after OCR causes zero new OCR calls.
- [ ] Reload/reconnect during AI causes zero new model executions.
- [ ] Basketra restart retains the same idempotency key and remote execution ID.
- [ ] Lost async-create response reuses the same idempotency key and resolves to the same remote execution.
- [ ] Once a remote ID exists, automatic recovery performs GET only.
- [ ] Remote completion while Basketra is disconnected is recovered and copied into Basketra persistence.
- [ ] Locally copied final/page results survive remote execution expiry.
- [ ] Remote expiry/interruption before local copy is recoverable without automatic replay.
- [ ] Multi-page receipts resume from persisted page state without duplicating completed pages.
- [ ] Shutdown preserves recoverable durable work rather than marking it interrupted.
- [ ] Explicit cancellation does not replay work.
- [ ] Explicit retry increments generation and creates exactly one new remote execution.
- [ ] Existing five-minute budget uses the original absolute deadline across reload/restart.
- [ ] Existing replay-safety contract remains green.
- [ ] `pnpm quality` and canonical browser/security/container checks pass.
- [ ] Exact-head CI is green.

## Checks
Run `pnpm quality` plus canonical browser, security, container and architecture checks. Validate empty migration setup and upgrade from schema v5 to v6. Validate restart with real SQLite persistence in deterministic integration tests.

## Rollback
Revert the additive receipt-job migration and provider/job orchestration changes together. Never rewrite an already applied migration. If v6 has already been applied, rollback code must tolerate the additive columns/state rather than mutating migration history.

## Delivery
Branch `agent/feat-durable-receipt-ai`. Companion webApi branch: `agent/feat-durable-ai-executions`, PR #104. No merge, release or deployment without explicit approval.

## Status
Recon and durable state/recovery contract documented. Implementation pending. webApi companion implementation exists but its exact-head CI still has formatting and TypeScript build failures to resolve before Basketra switches to the durable remote contract.
