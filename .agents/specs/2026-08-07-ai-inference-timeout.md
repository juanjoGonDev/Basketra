# AI inference timeout ownership

## Request

Remove Basketra's default end-to-end AI inference deadline after production evidence showed the real multimodal capability probe being aborted with `AI_TIMEOUT` while webApi was still processing. Keep explicit user/request cancellation, bounded response sizes, retry bounds, and provider-originated timeout classification.

## Evidence

- Production release `1.0.4` logged `ai.capability_probe_failed` with HTTP 504 / `AI_TIMEOUT` after roughly the configured Basketra deadline.
- `loadConfig()` defaults `BASKETRA_AI_TIMEOUT_MS` to 30000.
- `OpenAiCompatibleProvider.executeStructured()` creates an AbortController and aborts the entire fetch after `timeoutMs`.
- Both Compose variants inject a 30000 ms default into the container.
- webApi may legitimately take longer than 30 seconds for multimodal image plus strict JSON-schema generation.

## Decision

1. Basketra must not impose an end-to-end inference deadline by default.
2. `aiTimeoutMs = 0` means no Basketra-owned provider deadline.
3. Both supported Compose variants explicitly run Basketra with `BASKETRA_AI_TIMEOUT_MS=0`, so stale host `.env` values cannot reintroduce the old 30-second deadline after upgrade.
4. `.env.example` documents the disabled deadline as `0`.
5. Keep the existing positive timeout implementation as an explicit low-level/operator opt-in for non-Compose integrations and deterministic tests.
6. Keep upstream HTTP 408/504 mapped to `AI_TIMEOUT`; those are provider-owned failures, not Basketra-generated deadlines.
7. External AbortSignal cancellation remains authoritative and must still abort immediately.

## Acceptance criteria

- [ ] Default application config resolves `aiTimeoutMs` to `0`.
- [ ] A provider configured with `timeoutMs: 0` can remain pending beyond the former deadline and completes normally when the upstream response arrives.
- [ ] Explicit external cancellation still aborts a no-deadline provider request.
- [ ] A positive explicitly configured timeout still maps to retryable `AI_TIMEOUT`.
- [ ] HTTP 408/504 from webApi/provider still maps to retryable `AI_TIMEOUT`.
- [ ] Compose and Raspberry Compose do not inject the old 30000 ms deadline.
- [ ] No response-size, retry, queue, security, or cancellation bound is weakened.
- [ ] Required repository and CI checks pass on the exact PR head.

## Tests

- Extend configuration tests for the zero default and zero acceptance.
- Extend provider edge-case coverage to prove no self-abort when timeout is zero while preserving external cancellation and positive-timeout behavior.
- Run the repository quality, browser, security, resource, container, architecture, and CodeQL gates through CI.

## Risk and rollback

A hung upstream request can now remain active until the client cancels, the transport fails, the provider returns, or the process shuts down. This is intentional for long-running inference and remains bounded by the one-slot AI queue, explicit request cancellation, response-size caps, container resources, and provider/webApi controls. Rollback is a focused revert; there is no schema or data migration.

## Status

Implementation in progress on `agent/fix-ai-inference-timeout`. No merge, release, publication, deployment, Raspberry mutation, or secret change has been performed.
