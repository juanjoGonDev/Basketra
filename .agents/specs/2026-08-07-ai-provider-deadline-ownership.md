# AI provider deadline ownership

## Request

Remove Basketra-owned wall-clock deadlines from OpenAI-compatible provider requests. The deployed Settings capability probe reached webApi but failed with `AI_TIMEOUT` after Basketra's configured deadline. Basketra must allow the provider/webApi operation to finish on its own schedule while preserving explicit cancellation, bounded response bodies, bounded retries, concurrency limits, and stable upstream timeout classification.

Do not merge, release, publish, deploy, rotate credentials, or modify the Raspberry host from this PR.

## Evidence

- Production version `1.0.4` reported `ai.capability_probe_failed` with HTTP `504` and `AI_TIMEOUT` after the manual multimodal capability probe.
- `OpenAiCompatibleProvider.executeStructured()` currently creates an internal `AbortController`, starts a timer from `config.timeoutMs`, aborts the provider fetch when it expires, and converts that local abort into `AI_TIMEOUT`.
- `AppConfig.aiTimeoutMs` defaults from `BASKETRA_AI_TIMEOUT_MS=30000` and both Compose variants inject that value.
- The Settings probe and receipt/list AI paths share the same canonical provider transport, so this Basketra deadline affects production work as well as diagnostics.
- The browser HTTP client does not impose an AI request deadline.
- Receipt extraction already propagates an HTTP request-abort signal through `ReceiptExtractionService` into provider calls.
- Upstream HTTP `408` and `504` are already normalized to `AI_TIMEOUT`; that mapping describes a provider-owned timeout and remains useful after the local deadline is removed.

## Decision

1. Remove `timeoutMs` from `OpenAiCompatibleProvider` configuration and stop synthesizing an internal deadline signal.
2. Pass through only the caller-provided `AbortSignal` to `fetch`.
3. Preserve explicit cancellation as `AbortError`; do not reclassify caller cancellation as provider failure.
4. Preserve upstream HTTP `408`/`504` mapping to retryable `AI_TIMEOUT` because those responses originate outside Basketra.
5. Remove `aiTimeoutMs` and `BASKETRA_AI_TIMEOUT_MS` from the application configuration, local Compose, Raspberry Compose, `.env.example`, README, deployment runbook, and canonical product specification.
6. Ensure expensive Settings-provider and shopping-list AI requests are cancelled when their inbound HTTP request is aborted, so removing the deadline does not leave orphaned provider work after the client disconnects.
7. Keep receipt request cancellation, one-slot AI serialization, bounded retries, bounded provider responses/error metadata, and all existing resource limits unchanged.
8. Update user-facing `AI_TIMEOUT` guidance to state that the provider/upstream timed out rather than implying a Basketra-configured deadline.

## Acceptance criteria

- [ ] Basketra never aborts an AI provider request because elapsed wall-clock time reached an application-configured threshold.
- [ ] `OpenAiCompatibleProvider` has no timeout configuration or internal timeout timer.
- [ ] A caller-provided abort signal is passed to the provider request and still produces `AbortError`.
- [ ] A provider HTTP `408` or `504` still maps to retryable `AI_TIMEOUT`.
- [ ] Capability probes wait for provider completion unless the requesting client disconnects or the provider itself terminates/fails.
- [ ] Receipt verification continues to cancel when its inbound HTTP request is aborted.
- [ ] Shopping-list AI and both provider-test routes cancel provider work when the inbound HTTP request is aborted.
- [ ] `BASKETRA_AI_TIMEOUT_MS` is absent from runtime configuration, Compose variants, environment examples, and operational documentation.
- [ ] UI recovery text no longer says Basketra's configured timeout expired.
- [ ] Regression tests prove there is no synthesized provider signal/deadline and prove caller cancellation/upstream timeout behavior.
- [ ] Changed backend and browser production code meet the repository's differential coverage requirements.
- [ ] Quality, Browser E2E, Security, container smoke, AMD64, ARM64, CodeQL, and PR visual evidence pass on the exact PR head.

## Risks

Without a Basketra wall-clock deadline, a provider that never responds can occupy the single AI slot while its client remains connected. This is intentional deadline ownership: Basketra will not guess how long browser-backed AI work is allowed to take. Availability is bounded instead by one-slot AI concurrency, explicit inbound-request cancellation, finite retry count after an actual provider failure, provider/network termination, and bounded response sizes.

A future configurable deadline must not be reintroduced silently. If an operator later needs one, it requires an explicit product decision defining ownership and semantics rather than a hidden default.

## Tests

- Unit: provider sends no synthesized abort signal when the caller supplies none; caller signal is forwarded unchanged; upstream `408/504` still classifies as `AI_TIMEOUT`; no local-timeout test remains.
- Unit/config: removed timeout environment input is ignored and `AppConfig` exposes no AI deadline.
- API/integration: aborted inbound provider-test and shopping-list requests propagate cancellation without becoming `AI_TIMEOUT` or `AI_UNREACHABLE`.
- Browser: provider timeout guidance attributes the failure to webApi/provider, not Basketra configuration.
- Existing receipt cancellation, retry, response-size, concurrency, security, resource, and container tests remain blocking.

## Rollback

Revert this PR. No schema, persisted-data, provider credential, or Raspberry mutation is involved.

## Delivery status

Implementation pending on `agent/fix-ai-provider-timeout`. Production validation is explicitly out of scope until an approved merge/release/deployment occurs.
