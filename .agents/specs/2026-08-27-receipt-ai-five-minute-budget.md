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
- `StructuredAiExecutor` currently treats a generic `AbortError` as retryable, which conflicts with explicit cancellation and with a terminal Basketra-owned receipt deadline.
- The current receipt recovery copy says Basketra imposes no verification time limit; that statement becomes stale under this decision.

## Decision

1. Basketra receipt AI verification has one hard total budget of 300,000 ms (five minutes).
2. The budget starts once the `verifyWithAi` receipt verification stage begins and spans queue wait, ordered pages, provider calls, and all executor retries. It is created once and is never reset per page or retry.
3. The budget is receipt-specific. Do not restore a generic provider timeout or change webApi's timeout semantics.
4. When the budget expires, abort the currently active receipt AI work through the existing `AbortSignal` path and terminate the receipt verification with a stable Basketra-owned `AI_RECEIPT_TIMEOUT` error.
5. Deadline expiry is terminal. No outer retry may rebuild or resend the original OCR/image/PDF request after expiry.
6. Explicit caller cancellation remains distinct and must continue to propagate as `AbortError`; it must not be reclassified as the five-minute receipt timeout unless the receipt deadline itself actually expired.
7. `StructuredAiExecutor` must treat abort/cancellation as terminal and never retry an already-aborted original request.
8. Existing webApi replay-safety metadata remains authoritative and unchanged.
9. The API maps `AI_RECEIPT_TIMEOUT` to HTTP 504 with redacted, actionable copy; the receipt recovery UI explains that Basketra stopped this receipt verification after five minutes while preserving the OCR/manual-review path.
10. No receipt content, OCR text, attachment bytes, provider body, credentials, or filesystem paths may be added to timeout logs/errors.

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

## Tests

- Executor regression: an `AbortError` is terminal even when retry budget remains.
- Receipt-service regression with a deterministic short injected test budget: one timeout signal governs the whole verification stage and aborts in-flight AI work.
- Prove the timeout is not reset by a retry or by moving to a later receipt page.
- Prove no provider invocation occurs after the receipt deadline expires.
- Prove caller cancellation remains `AbortError` and is not reported as `AI_RECEIPT_TIMEOUT` when the deadline has not expired.
- Prove `AI_RECEIPT_TIMEOUT` maps to HTTP 504 and UI recovery offers preserved OCR/manual review.
- Preserve existing replay-safety integration proving original receipt attachment POST count remains one after downstream progress.
- Run canonical quality, backend differential coverage, browser tests as applicable, security/container gates, and exact-head CI.

## Acceptance

- [ ] Basketra receipt AI verification cannot exceed a single 300,000 ms total budget.
- [ ] The same deadline spans queue wait, pages, and all retries without reset.
- [ ] Deadline expiry aborts in-flight provider work and terminates with `AI_RECEIPT_TIMEOUT`.
- [ ] No original OCR/image/PDF request is rebuilt or resent after deadline expiry.
- [ ] Generic provider/probe/list/photo operations remain without a Basketra wall-clock deadline.
- [ ] webApi remains free to run longer than five minutes according to its own inactivity and sub-operation contracts.
- [ ] Caller cancellation remains distinct and terminal.
- [ ] Existing replay-safety semantics remain intact.
- [ ] User-facing recovery copy accurately describes the Basketra-owned five-minute receipt limit.
- [ ] Exact-head required CI is green.

## Rollback

Revert the focused receipt-budget commits. No schema or persisted-data migration is involved. Reverting must restore the previous receipt timing behavior without changing webApi or generic provider timeout ownership.

## Delivery

Branch `agent/fix-receipt-ai-five-minute-budget` targeting `main`. Do not merge, release, publish, deploy, modify secrets, change protected branches, or mutate production data without explicit approval.

## Status

Recon complete. Implementation and exact-head validation pending.
