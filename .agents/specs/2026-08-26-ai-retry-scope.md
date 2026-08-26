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
- Exact-head PR quality later failed only in Trivy container scanning: Alpine runtime packages `libcrypto3` and `libssl3` were `3.5.7-r0` and affected by HIGH `CVE-2026-14456`; Trivy reported `3.5.8-r0` as the fixed version. Node package scanning reported zero findings.

## Decision

- Recognize webApi's `validated_output_correction_failed` error code as `AI_PROVIDER_FAILED` with `retryable: false`.
- Keep bounded retries for genuinely transient provider failures that occur before webApi establishes a correction context.
- Keep the canonical 240-character warning bound; make it explicit in the receipt verification instructions rather than widening storage/domain limits.
- Upgrade only `libcrypto3` and `libssl3` from the Alpine 3.24 repository before installing runtime OCR dependencies; do not suppress the Trivy finding or broadly upgrade unrelated packages.
- Do not log provider bodies, OCR text, attachments, credentials, or receipt content.

## Scope

- Provider error classification.
- Receipt verification prompt constraint.
- Regression coverage proving the correction-terminal error does not replay the original structured request.
- Targeted runtime OpenSSL security remediation discovered by the canonical container scan.
- No database, queue, storage, UI, deployment, or secret changes.

## Risks

- Requires the companion webApi change to emit the new bounded error code.
- Older webApi versions still return generic `internal_error`; deployment order must update webApi before relying on this classification.
- Alpine repository availability is required during image build, as it already is for OCR packages. The security fix intentionally upgrades only the two affected OpenSSL runtime packages.

## Acceptance

- [x] `validated_output_correction_failed` maps to a non-retryable `AI_PROVIDER_FAILED`.
- [x] `StructuredAiExecutor` makes one provider call for that error even when configured with retries.
- [x] Generic transient 5xx behavior remains bounded and retryable.
- [x] Receipt verification tells the model each warning must be at most 240 characters.
- [x] Runtime Dockerfile upgrades `libcrypto3` and `libssl3` before OCR dependency installation.
- [ ] Exact-head quality and CI pass, including Trivy container scanning.

## Tests

- Provider/error and executor regression in `tests/unit/ai-retry-scope.test.ts`.
- Receipt prompt regression in `tests/unit/receipt-ai-warning-contract.test.ts`.
- Container security contract regression in `tests/unit/container-security-contract.test.ts`.
- Existing provider retry tests continue to cover bounded generic transient 5xx behavior.
- Existing integration, browser, security, container, AMD64, ARM64, and CodeQL checks remain authoritative.

## Rollback

Revert the focused commits. No persisted data or schema migration is involved. If only the OpenSSL remediation must be rolled back, revert its Dockerfile and contract-test commits together; do not waive a still-active HIGH vulnerability without separate evidence.

## Delivery

Target PR #35 from `agent/fix-ai-retry-scope` to `main`. Companion webApi PR #101 targets `master`. Do not merge, release, deploy, publish, or change secrets without explicit approval.

## Status

Implementation and targeted container security remediation complete; exact-head quality and CI pending.
