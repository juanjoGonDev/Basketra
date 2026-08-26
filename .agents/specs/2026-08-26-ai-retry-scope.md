# AI provider retry scope

## Request

Stop Basketra from replaying the original receipt OCR request and uploading the same image again when webApi has already produced a model response and a subsequent structured-output correction fails.

## Evidence

- Production's first webApi execution completed successfully and produced the structured receipt response.
- webApi's correction-only second turn used the same conversation and no attachment.
- That correction failed with a ChatGPT renderer liveness error.
- Basketra currently maps every generic provider HTTP 5xx to `AI_PROVIDER_FAILED` with `retryable: true`.
- `StructuredAiExecutor` then calls `provider.executeStructured()` again with the original input, including its image attachment.
- The receipt schema requires every warning to be at most 240 characters, but the receipt verification system prompt did not state that bound explicitly.

## Decision

- Recognize webApi's `validated_output_correction_failed` error code as `AI_PROVIDER_FAILED` with `retryable: false`.
- Keep bounded retries for genuinely transient provider failures that occur before webApi establishes a correction context.
- Keep the canonical 240-character warning bound; make it explicit in the receipt verification instructions rather than widening storage/domain limits.
- Do not log provider bodies, OCR text, attachments, credentials, or receipt content.

## Scope

- Provider error classification.
- Receipt verification prompt constraint.
- Regression coverage proving the correction-terminal error does not replay the original structured request.
- No database, queue, storage, UI, deployment, or secret changes.

## Risks

- Requires the companion webApi change to emit the new bounded error code.
- Older webApi versions still return generic `internal_error`; deployment order must update webApi before relying on this classification.

## Acceptance

- [x] `validated_output_correction_failed` maps to a non-retryable `AI_PROVIDER_FAILED`.
- [x] `StructuredAiExecutor` makes one provider call for that error even when configured with retries.
- [x] Generic transient 5xx behavior remains bounded and retryable.
- [x] Receipt verification tells the model each warning must be at most 240 characters.
- [ ] Exact-head quality and CI pass.

## Tests

- Provider/error and executor regression in `tests/unit/ai-retry-scope.test.ts`.
- Receipt prompt regression in `tests/unit/receipt-ai-warning-contract.test.ts`.
- Existing provider retry tests continue to cover bounded generic transient 5xx behavior.
- Existing integration, browser, security, container, AMD64, ARM64, and CodeQL checks remain authoritative.

## Rollback

Revert the focused commits. No persisted data or schema migration is involved.

## Delivery

Target a new PR from `agent/fix-ai-retry-scope` to `main`. Do not merge, release, deploy, publish, or change secrets without explicit approval.

## Status

Implementation complete; exact-head quality and CI pending.
