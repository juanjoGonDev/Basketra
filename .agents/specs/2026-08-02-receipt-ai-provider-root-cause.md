# Receipt AI provider root cause

## Request

Diagnose and correct the Basketra receipt verification failures across Basketra and its configured OpenAI-compatible webApi provider. Preserve local OCR and manual recovery, and do not present improved error classification as proof that the provider flow is fixed.

## Current evidence

- Production local OCR completed before AI verification returned `500 INTERNAL_ERROR`.
- PR #14 replaces generic failures with stable, redacted `AI_*` errors and bounds deterministic retries, but it does not exercise the complete provider workflow.
- Basketra currently tests only `GET /models` for provider connectivity.
- Receipt page work uses a two-slot queue whose task includes both OCR and AI verification, so two AI turns may run concurrently.
- The browser UI also schedules two page pipelines and issues a second request for AI verification after preserving OCR text.
- webApi currently treats attachment filename/readiness timeouts as best-effort and may proceed to prompt submission.

## Architecture findings

- `ReceiptExtractionService` is the canonical server-side owner of receipt page extraction.
- Local OCR and AI verification are separate effects but currently share one page-level concurrency boundary.
- `StructuredAiExecutor` is the canonical Basketra retry owner.
- `OpenAiCompatibleProvider` owns provider transport and error classification.
- `src/web/receipts.js` owns per-image progress, retry, cancellation, and manual recovery UX.
- Provider capability configuration and effective runtime probes must remain distinct: configured capability is not proven capability.

## Scope

- Preserve PR #14 error typing and mapping.
- Separate local OCR concurrency from AI verification concurrency, with AI defaulting to one.
- Add a backward-compatible structured capability probe for text structured output and image-plus-structured-output.
- Propagate a validated correlation identifier to webApi without making it authoritative.
- Map stable AI codes to specific user actions while preserving completed OCR and manual editing.
- Add realistic attachment-size and concurrency regression coverage.
- Document an exact Raspberry candidate validation and rollback procedure.

## Non-goals

- Replace the provider, local OCR, or storage architecture.
- Add external queues, workers, or databases.
- Disable all concurrency globally.
- Log receipt content, OCR text, Base64, prompt/schema bodies, provider bodies, filenames, or filesystem paths.
- Merge, release, or deploy without explicit approval.

## Risks

- Capability probing invokes the configured provider and may consume a limited request.
- Serial AI verification can increase total latency if UI feedback is not accurate.
- Duplicating queue ownership across frontend and backend could create drift.
- Adding a public response field must remain backward compatible.
- Provider error details can become a data-leak boundary if raw values are propagated.

## Prioritized hypotheses

1. webApi proceeds after attachment-readiness timeout.
2. Basketra starts two AI verifications concurrently and exposes provider/account race or throttling behavior.
3. The provider accepts `/models` but rejects image plus strict JSON Schema.
4. Realistic attachment size or upload duration exceeds current limits.
5. A failed browser composer/page contaminates a later turn.
6. A stable provider error code is currently collapsed to a generic HTTP classification.

## Decision

- Keep PR #14 as the error-contract foundation.
- Add one canonical AI verification queue in `ReceiptExtractionService`, independent from local OCR scheduling.
- Default AI verification concurrency to one; do not reduce local OCR concurrency.
- Extend the existing provider test endpoint without removing or changing existing fields.
- Probe with a tiny synthetic non-user image and minimal strict schema.
- Treat live ChatGPT and Raspberry testing as a separate pending validation stage.

## Acceptance criteria

- Local OCR results and page state survive every recognized AI failure.
- Two local OCR operations may progress while no more than one AI verification is active by default.
- `GET /models` success is reported separately from `imageStructuredOutput` capability.
- Known provider failures never map to `INTERNAL_ERROR`.
- Deterministic failures are not retried; transient failures are retried only within the existing bounded executor.
- Basketra forwards a bounded correlation ID and webApi can record it as non-authoritative metadata.
- UI recovery actions differ for authentication, capability, attachment size/upload, rate limit, timeout, rejection, outage, and provider failure.
- Tests cover realistic image sizes, concurrent pages, one failed page followed by success, and manual completion.
- All repository quality, security, browser, container, AMD64, ARM64, and CodeQL checks pass before delivery.
- Production is not declared fixed until Raspberry validation is completed.

## Tests

- Unit: queue FIFO/cancellation/release, separate OCR/AI limits, provider errors, retryability, capability probe parsing, correlation validation, UI action mapping.
- Integration: `/models` succeeds while image structured output fails; realistic 1.7 MiB image; two OCR tasks with one AI slot; failed first AI turn followed by successful second; redacted logs/responses.
- Browser: three images, two OCR tasks visible, one AI verification active, deterministic and transient recovery, manual confirmation, responsive and accessible actions.

## Security constraints

- No receipt content, OCR text, Base64, prompts, schemas, provider response bodies, credentials, cookies, authorization headers, filenames, or filesystem paths in logs or API errors.
- Provider URL remains configuration-only.
- Correlation IDs are validated, bounded, and never used for authorization.
- Provider responses and error bodies remain bounded.
- No new runtime dependency.

## Rollback

Revert the focused commits in Basketra and webApi independently. No schema or data migration is required. Keep local OCR/manual review available during rollback. Do not promote a candidate unless the previous stable image and exact rollback commands are recorded.

## Validation commands

- `pnpm quality`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm test:browser`
- `pnpm docker:smoke`
- repository security scan
- CI linux/amd64 and linux/arm64 builds
- CodeQL
- explicit Raspberry candidate validation after approval

## Delivery status

Implementation in progress on the existing PR #14 branch `agent/fix-receipt-ai-provider-failures`. webApi changes are tracked separately on `agent/fix-attachment-readiness-and-concurrency`. No merge, release, or deployment is authorized.
