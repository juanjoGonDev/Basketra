# Durable receipt AI reconciliation

## Request
Persist receipt OCR and downstream webApi execution identity on the Basketra server so browser reloads, reconnects and Basketra restarts reconcile existing work instead of repeating OCR or resubmitting the receipt image.

## Evidence
- Basketra already persists `receipt_extraction_jobs`, but each job currently stores only its original request and final result/error.
- `ReceiptExtractionService.extract()` currently performs OCR and AI verification in one process lifetime.
- On Basketra startup, running receipt extraction jobs are converted to failed/interrupted; their OCR evidence is not persisted independently.
- The browser already uses the asynchronous extraction-job API plus realtime invalidation/status refresh.
- webApi replay safety prevents known post-progress duplicate turns, but Basketra still needs durable remote execution reconciliation across process/browser lifetime boundaries.

## Decision
- Keep `receipt_extraction_jobs` as the single Basketra owner; extend it rather than adding a parallel job table.
- Persist an absolute `deadlineAt` when the AI job is created. Reload/restart never resets the five-minute Basketra receipt-AI budget.
- Persist OCR/deterministic page evidence before starting remote AI verification.
- Persist a deterministic generation-specific idempotency key before creating each remote webApi execution.
- Persist the returned webApi execution ID and reconcile it with GET status calls. Once an execution ID exists, automatic recovery performs GET only; it never reconstructs the original POST.
- Persist each completed remote result into the Basketra job before proceeding. The final Basketra result remains usable after webApi retention removes its execution row.
- A missing/expired/interrupted remote execution before Basketra copied its result becomes a recoverable terminal job failure. Automatic replay is forbidden; explicit user retry creates a new generation/key.
- Browser reload rehydrates the existing Basketra job. It does not invoke OCR or create a new remote AI execution.
- Deleting/cancelling a job removes its temporary persisted job state according to the existing extraction-job lifecycle.

## State model
`queued -> ocr_running -> ai_pending -> ai_running -> completed | failed | cancelled`

Remote execution identity is durable metadata inside the local job. `ai_pending` without a remote ID may retry creation only with the already persisted idempotency key. `ai_running` with a remote ID may only reconcile by GET.

## Acceptance
- [ ] OCR page evidence is persisted before remote AI creation.
- [ ] Reload after OCR causes zero new OCR calls.
- [ ] Reload/reconnect during AI causes zero new model POSTs.
- [ ] Basketra restart retains the same remote execution ID.
- [ ] Lost async-create response reuses the same idempotency key and resolves to the same remote execution.
- [ ] Remote completion while Basketra is disconnected is recovered and copied into Basketra persistence.
- [ ] Locally copied final result survives remote execution expiry.
- [ ] Remote expiry/interruption before local copy is recoverable without automatic replay.
- [ ] Explicit retry increments generation and creates exactly one new remote execution.
- [ ] Existing five-minute budget uses the original absolute deadline across reload/restart.
- [ ] Existing replay-safety contract remains green.
- [ ] Exact-head CI is green.

## Checks
Run `pnpm quality` plus canonical browser, security, container and architecture checks.

## Rollback
Revert the additive receipt-job migration and provider/job orchestration changes together. Never rewrite an already applied migration.

## Delivery
Branch `agent/feat-durable-receipt-ai`. Companion webApi branch: `agent/feat-durable-ai-executions`. No merge, release or deployment without explicit approval.

## Status
Specified; implementation pending.
