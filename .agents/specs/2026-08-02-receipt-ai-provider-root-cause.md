# Receipt AI provider root cause

## Request

Diagnose and correct the Basketra receipt verification failures across Basketra and its configured OpenAI-compatible webApi provider. Preserve local OCR and manual recovery, and do not present improved error classification as proof that the provider flow is fixed.

## Current evidence

- Production local OCR completed before AI verification returned `500 INTERNAL_ERROR`.
- The initial PR #14 replaced generic failures with stable, redacted `AI_*` errors and bounded deterministic retries, but did not exercise the complete provider workflow.
- Basketra still tests only `GET /models` for provider connectivity; this is explicitly not treated as proof of multimodal structured capability.
- The previous receipt page queue covered both OCR and AI verification, allowing two AI turns to run concurrently.
- The browser UI schedules two page pipelines and issues a second request for AI verification after preserving OCR text.
- The companion webApi investigation proved that attachment and composer readiness timeouts were swallowed before prompt submission.

## Architecture findings

- `ReceiptExtractionService` is the canonical server-side owner of receipt page extraction.
- Local OCR and AI verification are separate effects and now use separate bounded queues.
- `StructuredAiExecutor` is the canonical Basketra retry owner and reuses one correlation identifier across attempts.
- `OpenAiCompatibleProvider` owns provider transport, correlation propagation, and bounded allowlisted error classification.
- `src/web/receipts.js` owns per-image progress, retry, cancellation, and manual recovery UX.
- Provider capability configuration and effective runtime probes remain distinct: configured capability is not proven capability.

## Scope

- Preserve and extend PR #14 error typing and mapping.
- Separate local OCR concurrency from AI verification concurrency, with AI defaulting to one.
- Propagate a validated correlation identifier to webApi without making it authoritative.
- Consume only bounded allowlisted provider error metadata.
- Preserve completed OCR and manual editing after AI failure.
- Add realistic attachment-size and concurrency regression coverage.
- Document the remaining capability-probe, UI, authenticated-provider, and Raspberry validation work precisely.

## Non-goals

- Replace the provider, local OCR, or storage architecture.
- Add external queues, workers, or databases.
- Disable all concurrency globally.
- Log receipt content, OCR text, Base64, prompt/schema bodies, provider bodies, filenames, or filesystem paths.
- Merge, release, or deploy without explicit approval.

## Risks

- Serial AI verification can increase total latency if UI feedback is not accurate.
- Duplicating queue ownership across frontend and backend could create drift.
- Provider error details can become a data-leak boundary if raw values are propagated.
- The current Settings connection test may still give a false sense of full provider compatibility.
- The UI still uses its existing generic AI recovery-action pattern.

## Prioritized hypotheses

1. webApi proceeded after attachment-readiness timeout. Proven in the companion repository and corrected in webApi PR #8.
2. Basketra started two AI verifications concurrently. Proven by architecture and corrected by a server-authoritative AI queue with concurrency one.
3. The provider may accept `/models` but reject image plus strict JSON Schema. Not yet tested against the live provider.
4. Realistic attachment size or upload duration may exceed runtime limits. Covered deterministically with a 1.7 MiB fixture; live validation remains pending.
5. A failed browser composer/page may contaminate a later turn. Covered by webApi cleanup and same-page recovery tests; live validation remains pending.
6. Stable provider error codes were collapsed to generic classifications. Corrected with bounded allowlisted metadata parsing.

## Decision

- Keep PR #14 as the Basketra error-contract foundation.
- Use one canonical AI verification queue in `ReceiptExtractionService`, independent from local OCR scheduling.
- Default AI verification concurrency to one without reducing local OCR concurrency.
- Keep `StructuredAiExecutor` as the only retry owner.
- Reuse one correlation ID across retries and send it through a validated `x-client-request-id` header.
- Read at most 8 KiB of provider error JSON and consume only allowlisted code/type fields.
- Defer the real capability probe and UI action redesign rather than claiming they were implemented.
- Treat live ChatGPT and Raspberry testing as separate pending validation stages.

## Acceptance criteria

Implemented and validated:

- Local OCR results and page state survive recognized AI failures.
- Two local OCR operations may progress while no more than one AI verification is active by default.
- Known provider failures map to stable `AI_*` codes rather than `INTERNAL_ERROR`.
- Deterministic failures are not retried; transient failures remain bounded by the existing executor.
- Basketra forwards a bounded correlation ID and webApi records it as non-authoritative metadata.
- Provider error bodies are bounded and raw content is not propagated.
- Tests cover a realistic 1.7 MiB image payload and separate OCR/AI concurrency.
- Repository quality, security, browser, container, AMD64, ARM64, CodeQL, and visual-evidence checks pass.

Still pending before production closure:

- `GET /models` success must be reported separately from a real `imageStructuredOutput` capability probe.
- UI recovery actions must differ by stable error code.
- Authenticated live ChatGPT verification must pass through webApi PR #8.
- Raspberry Pi candidate validation must pass with realistic one- and three-image flows.

## Tests

Implemented:

- Unit coverage for queue FIFO/cancellation/release, separate OCR/AI limits, provider errors, retryability, bounded metadata parsing, correlation validation, and correlation reuse.
- Realistic 1.7 MiB image coverage with a multimodal payload exceeding two million encoded characters.
- Existing integration, E2E, browser, security, container, and platform-build suites.

Pending:

- Live provider matrix where `/models` succeeds but image plus strict structured output fails.
- Browser UI action mapping coverage by stable error code.
- Authenticated webApi attachment/composer execution and Raspberry candidate validation.

## Security constraints

- No receipt content, OCR text, Base64, prompts, schemas, provider response bodies, credentials, cookies, authorization headers, filenames, or filesystem paths in the new logs or API errors.
- Provider URL remains configuration-only.
- Correlation IDs are validated, bounded, and never used for authorization.
- Provider responses and error bodies remain bounded.
- No new runtime dependency.
- Raspberry validation must confirm `AGENTA_CAPTURE_CONTENT=false` in webApi before receipt processing.

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

Basketra implementation is committed and pushed on the existing PR #14 branch `agent/fix-receipt-ai-provider-failures`. CI passed quality, tests, security, browser E2E, container smoke, linux/amd64, linux/arm64, CodeQL, and visual evidence for the implementation head before this documentation-only update. The companion webApi implementation is in PR #8 on `agent/fix-attachment-readiness-and-concurrency`. No merge, release, deployment, or remote migration has occurred. Real capability probing, code-specific UI actions, authenticated live-provider execution, and Raspberry validation remain explicitly pending.
