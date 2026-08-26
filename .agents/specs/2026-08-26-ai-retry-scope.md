# AI provider retry scope

> Historical specification. The code-specific replay decision in this document is superseded by `.agents/specs/2026-08-26-original-request-replay-safety.md`. The warning-length guidance and OpenSSL remediation remain valid.

## Request

Stop Basketra from replaying the original receipt OCR request and uploading the same image again when webApi has already produced a model response and a subsequent structured-output correction fails.

## Evidence

- Production's first webApi execution completed successfully and produced the structured receipt response.
- webApi's correction-only second turn used the same conversation and no attachment.
- That correction failed with a ChatGPT renderer liveness error.
- Basketra originally mapped every generic provider HTTP 5xx to `AI_PROVIDER_FAILED` with `retryable: true`.
- `StructuredAiExecutor` then called `provider.executeStructured()` again with the original input, including its image attachment.
- The receipt schema requires every warning to be at most 240 characters, but the receipt verification system prompt did not state that bound explicitly.
- Exact-head PR quality later failed only in Trivy container scanning: Alpine runtime packages `libcrypto3` and `libssl3` were `3.5.7-r0` and affected by HIGH `CVE-2026-14456`; Trivy reported `3.5.8-r0` as the fixed version. Node package scanning reported zero findings.

## Historical decision

- The initial replay fix recognized webApi's `validated_output_correction_failed` error code as `AI_PROVIDER_FAILED` with `retryable: false`.
- That code-specific approach is superseded by the replay-safety contract in `.agents/specs/2026-08-26-original-request-replay-safety.md` and is not the canonical retry rule.
- Keep the canonical 240-character warning bound explicit in receipt verification instructions rather than widening storage/domain limits.
- Upgrade only `libcrypto3` and `libssl3` from the Alpine 3.24 repository before installing runtime OCR dependencies; do not suppress the Trivy finding or broadly upgrade unrelated packages.
- Do not log provider bodies, OCR text, attachments, credentials, or receipt content.

## Scope

- Historical provider error classification.
- Receipt verification prompt constraint.
- Targeted runtime OpenSSL security remediation discovered by the canonical container scan.
- No database, queue, storage, UI, deployment, or secret changes.

## Acceptance

- [x] The initial code-specific regression was implemented and later superseded by explicit replay-safety semantics.
- [x] Generic transient pre-progress behavior remains bounded and retryable under the canonical replay-safety model.
- [x] Receipt verification tells the model each warning must be at most 240 characters.
- [x] Runtime Dockerfile upgrades `libcrypto3` and `libssl3` before OCR dependency installation.
- [x] Exact-head quality passed, including Trivy container scanning, on implementation head `16dfc7732842183959225cd7c4ee9c055d9f84b0`.

## Tests

- Replay semantics are now owned by `.agents/specs/2026-08-26-original-request-replay-safety.md` and its unit/integration coverage.
- Receipt prompt regression remains in `tests/unit/receipt-ai-warning-contract.test.ts`.
- Container security contract regression remains in `tests/unit/container-security-contract.test.ts`.

## Rollback

Revert the relevant focused commits. No persisted data or schema migration is involved. If only the OpenSSL remediation must be rolled back, revert its Dockerfile and contract-test commits together; do not waive a still-active HIGH vulnerability without separate evidence.

## Delivery

PR #35 targets `main`. Do not merge, release, deploy, publish, or change secrets without explicit approval.

## Status

Superseded for retry semantics by `.agents/specs/2026-08-26-original-request-replay-safety.md`; retained only for the historical warning and OpenSSL decisions.
