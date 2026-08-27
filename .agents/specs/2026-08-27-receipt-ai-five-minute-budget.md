# Receipt AI five-minute total budget

## Request

Bound Basketra receipt AI verification to five total minutes while allowing webApi itself to run for substantially longer operations when its own inactivity contract remains satisfied.

This product decision supersedes the earlier Basketra receipt-path assumption that Basketra must never own an elapsed-time budget. The new deadline is deliberately narrow: it belongs to receipt AI verification in Basketra, not to the generic OpenAI-compatible transport, provider capability probes, shopping-list analysis, product-photo analysis, or webApi.

## Evidence

- `ReceiptExtractionService.extract()` owns the complete receipt extraction workflow and invokes `verifyOcrPagesInOrder()` when `verifyWithAi` is enabled.
- `verifyOcrPagesInOrder()` serializes AI page verification through the one-slot AI queue and keeps one receipt conversation affinity across pages.
- `verifyReceiptWithAi()` delegates retry ownership to `StructuredAiExecutor`, which can re-invoke the complete original multimodal input for replay-safe transient failures.
- `AiStructuredInput.signal` already reaches `OpenAiCompatibleProvider`, runtime-capability discovery, and the final provider request.
- `OpenAiCompatibleProvider` intentionally has no internal wall-clock deadline; caller cancellation is the supported ownership boundary.
- Current replay-safety semantics forbid replaying the original multimodal request after webApi declares `originalRequestReplaySafe=false` / `retryScope=continuation_only`.
- `StructuredAiExecutor` previously treated a generic `AbortError` as retryable, which conflicted with explicit cancellation and with a terminal Basketra-owned receipt deadline.
- The previous receipt recovery copy said Basketra imposed no verification time limit; that statement became stale under this decision.
- CI on code head `a6bd8c3e75c14cb2c6ee1f2ca7d08ac6d2d360a4` passed format, lint, strict TypeScript, dead-code, dependency policy, unit/integration/E2E tests, differential coverage, resource/growth budgets, security, container smoke, and amd64/arm64 image builds before the documentation follow-up.

## Decision

1. Basketra receipt AI verification has one hard total budget of 300,000 ms (five minutes).
2. The budget starts once the `verifyWithAi` receipt verification stage begins and spans OCR work queued for that verified extraction, AI queue wait, ordered pages, provider calls, and all executor retries. It is created once and is never reset per page or retry.
3. The budget is receipt-specific. Do not restore a generic provider timeout or change webApi's timeout semantics.
4. When the budget expires, settle the Basketra-owned deadline result first, abort the currently active receipt work through the existing `AbortSignal` path, and terminate the verification with stable `AI_RECEIPT_TIMEOUT`.
5. Deadline expiry is terminal. No outer retry may rebuild or resend the original OCR/image/PDF request after expiry.
6. Explicit caller cancellation remains distinct and continues to propagate as `AbortError`; it is not reclassified as the five-minute receipt timeout when the receipt deadline has not expired.
7. `StructuredAiExecutor` treats abort/cancellation as terminal and never retries an already-aborted original request.
8. Existing webApi replay-safety metadata remains authoritative and unchanged.
9. The API maps `AI_RECEIPT_TIMEOUT` to HTTP 504 with redacted, actionable copy; the receipt recovery UI explains that Basketra stopped this receipt verification after five minutes while preserving the OCR/manual-review path.
10. No receipt content, OCR text, attachment bytes, provider body, credentials, or filesystem paths are added to timeout logs/errors.

## Scope

- `src/receipts/service.ts`: receipt-verification deadline ownership and signal composition.
- `src/ai/structured-executor.ts`: cancellation is terminal for outer retries.
- `src/api/errors.ts`: stable receipt-timeout API mapping.
- `src/web/receipt-ai-recovery.js`: accurate recovery guidance.
- Focused unit/integration tests for total-budget, cancellation, retry, and replay behavior.
- `spec.md` and operational/product documentation where the old no-Basketra-deadline statement is now stale.
- No database migration, provider configuration, secret, deployment, release, or webApi change in this Basketra PR.

## Risks

- Starting a fresh timeout per page or retry would violate the total-budget requirement and could multiply the intended five-minute bound.
- Mapping the local deadline to a generic provider timeout would obscure ownership and regress diagnostics.
- Treating caller cancellation and deadline expiry identically would produce incorrect user feedback.
- Aborting during a provider request must not trigger `StructuredAiExecutor` to replay the original multimodal request.
- The receipt AI queue is shared; the deadline signal must also cancel a receipt verification that is still waiting for the AI slot.
- The deadline timer must stay referenced while work is pending; `unref()` would allow an isolated Node process to exit before the budget can fire.
- Deadline rejection is scheduled before abort propagation so a synchronous abort listener cannot win the race and leak a generic `AbortError` for a locally expired budget.

## Tests

- Executor regression: an `AbortError` is terminal even when retry budget remains.
- Receipt-service regression with a deterministic short injected test budget: one timeout signal governs the whole verification stage and aborts in-flight AI work.
- Prove the timeout is not reset by a retry or by moving to a later receipt page.
- Prove no provider invocation occurs after the receipt deadline expires.
- Prove caller cancellation remains `AbortError` and is not reported as `AI_RECEIPT_TIMEOUT` when the deadline has not expired.
- Prove invalid injected test budgets cannot exceed the production five-minute policy or use invalid/non-integer values.
- Prove `AI_RECEIPT_TIMEOUT` maps to HTTP 504 and UI recovery offers preserved OCR/manual review.
- Preserve existing replay-safety integration proving original receipt attachment POST count remains one after downstream progress.
- Run canonical quality, backend differential coverage, browser tests as applicable, security/container gates, and exact-head CI.

## Acceptance

- [x] Basketra receipt AI verification cannot exceed a single 300,000 ms total budget.
- [x] The same deadline spans receipt OCR/queue wait, pages, and all retries without reset.
- [x] Deadline expiry aborts in-flight provider work and terminates with `AI_RECEIPT_TIMEOUT`.
- [x] No original OCR/image/PDF request is rebuilt or resent after deadline expiry.
- [x] Generic provider/probe/list/photo operations remain without a Basketra wall-clock deadline.
- [x] webApi remains free to run longer than five minutes according to its own inactivity and sub-operation contracts.
- [x] Caller cancellation remains distinct and terminal.
- [x] Existing replay-safety semantics remain intact.
- [x] User-facing recovery copy accurately describes the Basketra-owned five-minute receipt limit.
- [ ] Final documentation head passes exact-head required CI before delivery.

## Checks

- Code head `a6bd8c3e75c14cb2c6ee1f2ca7d08ac6d2d360a4`: `✅ Quality` passed after the timer lifecycle and differential-coverage fixes.
- The same code head passed security, container smoke, and both amd64/arm64 container builds; browser/CodeQL workflow completion remains subject to the final exact-head run after documentation is committed.
- The quality gate executed format, lint, `tsc --noEmit`, dead-code, dependency policy, unit/integration/E2E tests, domain coverage, combined changed-source coverage, differential coverage, and resource/growth budgets without weakening any gate.
- No deployment, release, publication, secret change, production mutation, or migration was performed.

## Rollback

Revert the focused receipt-budget commits. No schema or persisted-data migration is involved. Reverting must restore the previous receipt timing behavior without changing webApi or generic provider timeout ownership.

## Delivery

Branch `agent/fix-receipt-ai-five-minute-budget` targeting `main`. Do not merge, release, publish, deploy, modify secrets, change protected branches, or mutate production data without explicit approval.

## Status

Implementation and code-level validation are complete. Stable documentation is being aligned with the new ownership rule; delivery remains pending the final branch head's exact-head CI.
