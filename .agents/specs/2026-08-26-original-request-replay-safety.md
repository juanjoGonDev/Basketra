# Original AI request replay safety

## Request

Prevent Basketra from replaying an original multimodal AI request after webApi has made irreversible downstream progress. Retry eligibility must be determined by replay-safety semantics, not HTTP status or a growing error-code allowlist.

## Evidence

- `StructuredAiExecutor` owns Basketra's outer retry loop and re-invokes `provider.executeStructured()` with the complete original `AiStructuredInput` on every retry.
- The input can contain the receipt OCR prompt and an image/PDF attachment, so an outer retry reconstructs the original multimodal POST.
- webApi owns the downstream ChatGPT conversation and knows when a model reply/conversation already exists; Basketra cannot infer that phase reliably from HTTP status.
- The previous PR-specific solution recognizes `validated_output_correction_failed` as terminal. This does not protect future post-progress failures with another code/status and therefore does not encode the invariant.

## Decision

Consume explicit provider replay-safety metadata from webApi errors.

Canonical contract:

- `error.details.retryScope === "continuation_only"`
- `error.details.originalRequestReplaySafe === false`

Basketra rules:

1. `StructuredAiExecutor` may retry only when the provider failure is retryable AND the original request is not known to be replay-unsafe.
2. Once an error declares `originalRequestReplaySafe=false`, the original `AiStructuredInput` must never be passed to `provider.executeStructured()` again.
3. The decision must not depend on a particular webApi error code or status.
4. Existing pre-progress transient retries remain bounded by `maxRetries`.
5. Unknown/malformed replay metadata must not be interpreted as an instruction to disable legitimate existing pre-progress retry behavior; webApi is responsible for emitting the explicit post-progress contract.
6. OCR text, attachments, provider response bodies, credentials, and receipt content must not be added to logs or exception messages.

## Retry state machine

- `original_request_replayable`: no downstream progress is known; provider retryability controls bounded retries.
- `original_request_replay_unsafe`: provider contract reports irreversible downstream progress. This transition is terminal for original-request retries.
- `continuation_only`: only the downstream service that owns the conversation may continue it.
- `terminal`: Basketra propagates failure without rebuilding the original multimodal request.

`original_request_replay_unsafe -> original_request_replayable` is forbidden.

## Ownership

- webApi owns downstream phase and replay-safety declaration.
- `OpenAiCompatibleProvider` owns parsing bounded replay metadata from the webApi error envelope.
- `StructuredAiExecutor` owns the final Basketra retry decision.
- Receipt services/gateways must not add another original-request retry around the executor.

## Scope

- `src/ai/provider.ts`
- `src/ai/structured-executor.ts`
- integration/contract regression covering receipt OCR + image through the real provider/executor boundary.
- focused unit tests for provider metadata and executor retry semantics.
- Supersedes the code-specific terminal-failure decision in `.agents/specs/2026-08-26-ai-retry-scope.md`; unrelated warning guidance and security remediation remain valid.

## Risks

- Requires the companion webApi contract to emit replay metadata after downstream progress.
- If an older webApi omits metadata, Basketra retains existing bounded pre-progress-compatible behavior; deployment order should update webApi first.
- The error body parser remains bounded and does not retain/log sensitive provider details.

## Acceptance

- [x] A real Basketra receipt extraction containing OCR + image sends the original provider POST/attachment exactly once when webApi responds with post-progress replay-unsafe metadata.
- [x] The same behavior holds regardless of the concrete error code/status used in the fixture.
- [x] `StructuredAiExecutor` explicitly consults replay safety before retrying.
- [x] Provider parsing accepts only the bounded canonical replay fields and does not expose provider bodies.
- [x] Existing transient pre-progress retry behavior remains covered.
- [x] The traced receipt/service/provider path contains no second retry owner around `StructuredAiExecutor`.
- [x] Canonical quality passed on the implementation.
- [x] Exact-head PR validation passed on `16dfc7732842183959225cd7c4ee9c055d9f84b0`: Pull Request Quality, Browser E2E, Security, container smoke, amd64, arm64, CodeQL, and PR visual evidence all completed successfully.

## Tests

- Unit: provider metadata parsing and executor replay guard.
- Integration/contract: `ReceiptExtractionService` -> `OpenAiCompatibleProvider` -> deterministic mock webApi HTTP endpoint; original multipart image request count and file count must equal one.
- Existing receipt pipeline/provider, browser, security, container, AMD64/ARM64, and CodeQL checks remain authoritative.

## Rollback

Revert the replay-safety commits together with the companion webApi replay-safety commits. No persisted data or database migration is involved.

## Delivery

Continue PR #35 on `agent/fix-ai-retry-scope` targeting `main`. Do not merge, release, deploy, publish, change protected branches, or modify secrets without explicit approval.

## Status

Implementation, unit coverage, cross-service contract regression, security checks, browser checks, and implementation-head CI are complete. Final documentation-only head validation pending.
