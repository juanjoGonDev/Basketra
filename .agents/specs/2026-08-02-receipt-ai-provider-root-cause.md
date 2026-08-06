# Receipt AI provider root cause

## Request

Diagnose and correct the Basketra receipt verification failures across Basketra and its configured OpenAI-compatible webApi provider. Preserve local OCR and manual recovery, and do not present improved error classification as proof that the provider flow is fixed.

## Current evidence

- Production local OCR completed before AI verification returned `500 INTERNAL_ERROR`.
- The initial PR #14 replaced generic failures with stable, redacted `AI_*` errors and bounded deterministic retries, but did not originally exercise the complete provider workflow.
- Basketra previously tested only `GET /models`, which did not prove authentication, image attachment, composer readiness, model routing, strict Structured Outputs, or response parsing together.
- The previous receipt page queue covered both OCR and AI verification, allowing two AI turns to run concurrently.
- The companion webApi investigation proved that attachment and composer readiness timeouts were swallowed before prompt submission.
- webApi PR #8 corrected attachment readiness and serialized reused browser-page turns.
- webApi PR #9 passed the mandatory unauthenticated live image-attachment smoke test.
- webApi now authenticates functional routes with database-backed managed Bearer tokens created in `/admin`; the static `API_KEY` setting was removed.

## Architecture findings

- `ReceiptExtractionService` is the canonical server-side owner of receipt page extraction.
- Local OCR and AI verification are separate effects and use separate bounded queues.
- `StructuredAiExecutor` is the canonical Basketra retry owner and reuses one correlation identifier across attempts.
- `OpenAiCompatibleProvider` owns provider transport, authentication, correlation propagation, bounded allowlisted error classification, and the synthetic capability probe.
- `OperationsGateway` delegates the Settings probe to `OpenAiCompatibleProvider`; it does not maintain a parallel raw-fetch implementation.
- `src/web/receipts.js` owns per-image progress, retry, cancellation, and manual recovery UX.
- Provider capability configuration and effective runtime probes remain distinct: configured capability is not proven capability.

## Scope

- Preserve and extend PR #14 error typing and mapping.
- Separate local OCR concurrency from AI verification concurrency, with AI defaulting to one.
- Propagate a validated correlation identifier to webApi without making it authoritative.
- Consume only bounded allowlisted provider error metadata.
- Preserve completed OCR and manual editing after AI failure.
- Add realistic attachment-size and concurrency regression coverage.
- Replace the Settings-only `/models` check with one bounded synthetic image plus strict JSON Schema probe through the canonical provider.
- Document managed webApi token provisioning and exact remaining target-host validation.

## Non-goals

- Replace the provider, local OCR, or storage architecture.
- Add external queues, workers, or databases.
- Disable all concurrency globally.
- Log receipt content, OCR text, Base64, prompt/schema bodies, provider bodies, filenames, filesystem paths, or credentials.
- Retry the manual Settings capability probe.
- Merge, release, or deploy without explicit approval.

## Risks

- Serial AI verification can increase total latency if UI feedback is not accurate.
- Duplicating queue ownership across frontend and backend could create drift.
- Provider error details can become a data-leak boundary if raw values are propagated.
- A synthetic probe can become misleading if it diverges from the production provider transport.
- A valid repository result does not prove Raspberry networking, deployed tokens, or the deployed webApi browser state.

## Proven root causes

1. webApi proceeded after attachment-readiness timeout. Proven and corrected in webApi PR #8.
2. Basketra started two AI verifications concurrently. Proven and corrected by a server-authoritative AI queue with concurrency one.
3. `/models` was an insufficient compatibility check. Corrected by one synthetic-image strict-schema probe through `OpenAiCompatibleProvider`.
4. Stable provider error codes were collapsed to generic classifications. Corrected with bounded allowlisted metadata parsing.

## Decision

- Keep PR #14 as the Basketra error-contract and provider-verification foundation.
- Use one canonical AI verification queue in `ReceiptExtractionService`, independent from local OCR scheduling.
- Default AI verification concurrency to one without reducing local OCR concurrency.
- Keep `StructuredAiExecutor` as the only production retry owner.
- Reuse one correlation ID across retries and send it through a validated `x-client-request-id` header.
- Read at most 8 KiB of provider error JSON and consume only allowlisted code/type fields.
- Implement `OpenAiCompatibleProvider.testConnection()` as one no-retry `POST /v1/chat/completions` request with a synthetic PNG and strict JSON Schema.
- Require the parsed response to be exactly `{ "accepted": true }` before reporting capability success.
- Use a managed webApi token in `BASKETRA_AI_API_KEY`; do not restore the removed webApi `API_KEY` setting.
- Treat Raspberry and deployed webApi validation as a separate approval-gated stage.

## Acceptance criteria

Implemented:

- [x] Local OCR results and page state survive recognized AI failures.
- [x] Two local OCR operations may progress while no more than one AI verification is active by default.
- [x] Known provider failures map to stable `AI_*` codes rather than `INTERNAL_ERROR`.
- [x] Deterministic failures are not retried; transient production failures remain bounded by the existing executor.
- [x] Basketra forwards a bounded correlation ID and webApi records it as non-authoritative metadata.
- [x] Provider error bodies are bounded and raw content is not propagated.
- [x] Tests cover a realistic 1.7 MiB image payload and separate OCR/AI concurrency.
- [x] Settings uses the canonical provider client rather than a duplicate `/models` fetch.
- [x] The capability probe sends one synthetic PNG, a managed Bearer token when configured, a validated correlation ID, and strict JSON Schema.
- [x] The capability probe performs no retry and rejects invalid structured output.
- [x] Browser UX reports the real request and stable failure classes without exposing the token.
- [x] `.env.example`, README, and Raspberry deployment guidance describe managed webApi tokens and the real probe.
- [ ] Exact-head quality, integration, E2E, browser, security, container, AMD64, ARM64, CodeQL, and visual-evidence checks pass after the final documentation update.

Pending before production closure:

- [ ] The approved Raspberry candidate uses a valid managed webApi token.
- [ ] webApi runs with `AGENTA_CAPTURE_CONTENT=false`.
- [ ] One-image and three-image receipt flows complete through the deployed immutable candidates.
- [ ] OCR evidence remains available after an induced deployed AI failure.
- [ ] Runtime limits and the one-slot AI queue are verified on the target host.

## Tests

Implemented:

- Unit coverage for queue FIFO/cancellation/release, separate OCR/AI limits, provider errors, retryability, bounded metadata parsing, correlation validation, correlation reuse, probe request shape, authentication, and invalid probe output.
- Integration coverage proving the gateway sends exactly one authenticated multimodal strict-schema request to the canonical provider endpoint.
- Browser coverage for configured, successful, unreachable, responsive, and private-route recovery states.
- Realistic 1.7 MiB image coverage with a multimodal payload exceeding two million encoded characters.
- Existing integration, E2E, security, container, and platform-build suites.

Pending:

- Approved target-host verification against the deployed managed-token webApi instance.

## Security constraints

- No receipt content, OCR text, Base64, prompts, schemas, provider response bodies, credentials, cookies, authorization headers, filenames, or filesystem paths in logs or API errors.
- The synthetic image is repository-owned, bounded, content-free test data.
- Provider URL remains configuration-only.
- Correlation IDs are validated, bounded, and never used for authorization.
- Provider responses and error bodies remain bounded.
- The managed token is created in webApi `/admin`, displayed once by webApi, stored only in the protected Basketra environment, and masked in Basketra Settings.
- No new runtime dependency.
- Raspberry validation must confirm `AGENTA_CAPTURE_CONTENT=false` in webApi before receipt processing.

## Rollback

Revert the focused Basketra commits independently. No schema or data migration is required. Keep local OCR/manual review available during rollback. Do not promote a candidate unless the previous stable image and exact rollback commands are recorded.

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

Basketra implementation is committed and pushed on the existing PR #14 branch `agent/fix-receipt-ai-provider-failures`. The companion webApi readiness, live attachment, and managed-token changes are merged to webApi `master`. No merge, release, deployment, secret rotation, Raspberry mutation, or remote migration has occurred. Repository CI is being rerun on the final documentation head; target-host validation remains explicitly pending and approval-gated.
