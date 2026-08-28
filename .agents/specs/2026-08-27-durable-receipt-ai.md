# Durable receipt AI reconciliation

## Request

Persist receipt OCR evidence and downstream webApi execution identity on the Basketra server so browser reloads, reconnects and Basketra restarts reconcile existing work instead of repeating OCR or resubmitting an already-known remote model execution.

## Evidence

- `receipt_extraction_jobs` was already the public asynchronous job owner, but legacy schema v5 stored only request/final state and process restart converted active work into `RECEIPT_EXTRACTION_INTERRUPTED`.
- Receipt OCR and AI verification previously depended on one Basketra process lifetime.
- The browser already uses extraction jobs plus realtime invalidation/status refresh, so recovery can remain read/reconcile-oriented without adding a second public job API.
- Companion webApi PR #104 provides `POST /v1/responses`, `GET /v1/responses/:responseId`, cancellation and `Idempotency-Key` reconciliation.
- The implemented restart integration test starts a remote response, stops Basketra while GET reconciliation is waiting, opens a second Basketra instance on the same SQLite database and requires the original create count to remain one while recovery proceeds through GET only.
- Canonical Basketra CI on implementation head `a1994c388cfadfff80b752dc3547343eb031beaa` passed Quality, Security, container smoke, amd64, arm64, CodeQL and visual evidence. Browser E2E initially hit one unrelated shopping-list swipe flake; the evidence-based rerun on the same head passed all 52 browser tests.

## Scope

- Extend the existing receipt extraction job persistence/orchestration; do not add a competing job table or second receipt pipeline.
- Preserve the public extraction-job status contract while allowing richer internal durable phase/page state.
- Cover image and PDF/multimodal verification through the same durable remote execution contract.
- Preserve the existing five-minute receipt-AI budget as an absolute persisted deadline that restart/reload cannot reset.
- Browser reload/reconnect is reconciliation only and must not create another remote model execution for an already-known `responseId`.
- Keep stored file `storageKey` as the canonical owner of attachment bytes; durable job state references files instead of copying image/PDF bytes into SQLite.

## Decision

- Add migration v6 to extend the existing receipt extraction job lifecycle; migration v5 remains untouched.
- Persist `deadlineAt`, durable phase and per-page durable state before work advances beyond each recoverable boundary.
- Persist OCR/deterministic evidence before remote AI creation.
- Persist each page idempotency key before attempting remote create.
- A create response lost before `responseId` persistence may repeat the identical create request only with the already-persisted idempotency key.
- Persist the returned `resp_*` immediately. Once it exists, automatic recovery performs GET-only reconciliation and never reconstructs the original multimodal POST.
- Persist completed remote interpretation locally before advancing to the next page. Local persisted result is authoritative after copy.
- Remote 404/expiry/interruption before local copy becomes a recoverable terminal failure; automatic replay is forbidden.
- Startup resumes jobs with durable checkpoints and marks only legacy active jobs without durable state as `RECEIPT_EXTRACTION_INTERRUPTED`.
- Shutdown aborts local waiters/controllers without converting durable recoverable work into terminal failure.
- Explicit cancellation cancels only persisted known `resp_*` identities and does not execute create/get afterward.
- Remote error identifiers are normalized through one shared bounded alphabet/owner before persistence.

## Retry semantics

Durable recovery and explicit retry are deliberately different operations:

- Restart/reload recovery keeps the same Basketra job, same absolute deadline, same persisted page idempotency key and same remote `resp_*` identity.
- Each currently created durable Basketra job uses `generation: 1`; recovery never increments it.
- Explicit browser retry creates a new extraction job instead of mutating/reopening a terminal durable job. That new job therefore owns a new job ID and new idempotency namespace.
- AI-only retry may reuse OCR already preserved by the browser as embedded text, but it still creates a new server extraction job/remote generation rather than replaying a terminal job in place.
- The persisted `generation` field remains available for future same-job generation semantics, but incrementing it is not part of the current public retry contract.

This replaces the earlier draft assumption that explicit retry increments the generation of the same durable job.

## State model

Public job status remains compatible with existing consumers. Internal durable phase is:

`queued -> ocr_running -> ai_pending -> ai_running -> completed | failed | cancelled`

Per-page remote state is:

`pending -> creating -> remote_running -> completed | failed`

Rules:

- OCR runs only when no persisted/embedded reusable OCR evidence exists for the page.
- `ai_pending` without a remote ID may POST only with the persisted page idempotency key.
- `ai_running` with a remote ID may reconcile only by GET.
- Persisted remote result is consumed locally without requiring another POST.
- Recovery never increments generation or resets the deadline.
- A new explicit retry is a new extraction job and therefore a new idempotency namespace.

## Persistence model

Migration v6 adds durable receipt-job/page metadata without duplicating file bytes:

- job generation;
- durable phase;
- absolute AI deadline;
- persisted OCR/deterministic page evidence;
- per-page idempotency key;
- per-page webApi `responseId`;
- per-page remote status/result/error required for recovery.

Terminal/pruned jobs follow the existing extraction-job retention lifecycle. Stored receipt bytes remain owned by the file store.

## Remote contract

Basketra consumes the companion webApi Responses subset:

- create: `POST /v1/responses` with `background: true`, `store: true`, structured `text.format`, multimodal input and persisted `Idempotency-Key`;
- reconcile: `GET /v1/responses/:responseId`, optionally using bounded `Prefer: wait=N`;
- cancel: `POST /v1/responses/:responseId/cancel` only for explicit local cancellation.

A network loss before Basketra receives create may repeat the same request/key. Once the response ID is known, automatic recovery is GET-only.

## Tests

Deterministic coverage proves:

- persisted OCR is reused after restart and OCR call count does not increase;
- lost create response repeats create with the same persisted idempotency key;
- persisted `responseId` makes restart reconciliation GET-only;
- remote completion while Basketra is disconnected is copied into local SQLite state;
- locally copied page/final results remain usable without another create;
- remote failure/expiry before local copy terminates recoverably without automatic replay;
- multi-page orchestration preserves page order and completed page checkpoints;
- absolute deadline is unchanged across restart;
- shutdown preserves durable recoverable work;
- explicit cancellation cancels only known remote responses;
- legacy active jobs without durable state still fail closed as interrupted;
- running jobs can resume without attempting an invalid `queued -> running` transition again;
- remote error code normalization accepts the shared bounded identifier alphabet and rejects unsafe values;
- OCR page position validation covers NaN, negative and upper-bound invalid positions.

The full server restart test uses real SQLite persistence and a long-wait remote GET boundary rather than replacing the production behavior with a weaker mock-only assertion.

## CI evidence

Observed CI failures were fixed without weakening gates:

- TypeScript required explicit `string | undefined` typing for `ReceiptResponsesClient.#apiKey`.
- Secret scanning rejected a credential-like test literal; the fixture now constructs non-secret test data without embedding a credential signature.
- Store assertions were corrected for SQLite objects with null prototypes.
- Retention pruning test now respects the exact cutoff boundary.
- Legacy schema expectation was advanced to additive schema v6 without rewriting migration v5.
- Diff coverage identified untested OCR position branches; boundary regression coverage was added rather than lowering coverage.

Implementation head `a1994c388cfadfff80b752dc3547343eb031beaa` then passed Quality, Security, container smoke, amd64, arm64, CodeQL and visual evidence. The isolated Browser E2E rerun passed 52/52 on the same head after an unrelated shopping-list swipe flake.

The authoritative final delivery gate is normal PR CI on the commit containing this finalized spec.

## Risks

- Crash between remote create and local `responseId` persistence: mitigated by persisting the idempotency key first and repeating only the identical create/key.
- Crash between remote completion and local result persistence: reconcile by GET using persisted `responseId`; never replay the original POST.
- Remote retention may remove a completed response before local copy: fail recoverably and require explicit new-job retry rather than assuming replay is safe.
- OCR/result JSON increases SQLite usage: fields remain bounded and job retention owns expiry; attachment bytes are never copied into job rows.
- Multi-page receipts can duplicate work if recovery is whole-receipt-only; page checkpoints therefore remain independent while orchestration stays sequential.
- Public browser status remains coarse; internal durable phases must not leak into a second competing UI contract.

## Acceptance

- [x] Additive migration v6 extends existing receipt extraction jobs and leaves migration v5 untouched.
- [x] OCR/deterministic page evidence is persisted before remote AI creation.
- [x] Recovery after OCR causes zero additional OCR calls.
- [x] Recovery with a persisted remote ID performs GET only and does not create another remote execution.
- [x] Restart retains the same idempotency key, remote response ID and absolute deadline.
- [x] Lost create response reuses the same persisted idempotency key.
- [x] Remote completion is copied into Basketra persistence before job completion.
- [x] Remote expiry/interruption before local copy fails recoverably without automatic replay.
- [x] Multi-page recovery resumes from persisted page state.
- [x] Shutdown preserves durable recoverable work.
- [x] Explicit cancellation does not replay work and targets only known remote responses.
- [x] Explicit retry is a new extraction job/new idempotency namespace; it does not mutate a terminal durable job in place.
- [x] Existing five-minute budget remains the original persisted absolute deadline across restart.
- [x] Legacy non-durable active jobs still fail closed as interrupted.
- [x] Shared remote error-code normalization has one bounded owner.
- [x] Canonical Quality/Security/container/browser coverage passed on the implementation head, including the evidence-based 52/52 Browser E2E rerun.

Exact-head CI is an external delivery gate tracked by PR checks and must be green before merge. It is not duplicated as a static checkbox that would become stale after this document is committed.

## Checks

Run canonical Quality, Browser E2E, Security, container smoke, linux/amd64, linux/arm64, CodeQL and visual-evidence checks. Validate both empty schema setup and upgrade to additive v6. Keep the real SQLite restart integration test in the suite.

## Rollback

Revert durable receipt-job migration/runtime/client changes together. Never rewrite an already-applied migration. If v6 has already been applied, rollback code must tolerate the additive schema rather than mutating migration history.

## Delivery

Branch `agent/feat-durable-receipt-ai`, PR #38. Companion webApi branch `agent/feat-durable-ai-executions`, PR #104. No merge, release or deployment without explicit approval.

## Status

Implementation and targeted CI remediation are complete. The durable runtime path is wired into `BasketraServer`, and the remaining authority is normal exact-head PR CI on this finalized documentation head. No merge, release or deployment is part of this task.
