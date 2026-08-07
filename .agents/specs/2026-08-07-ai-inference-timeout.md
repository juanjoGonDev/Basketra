# AI inference timeout ownership

## Request

Basketra must not impose a default end-to-end AI inference deadline. Production evidence showed the real multimodal capability probe being aborted with `AI_TIMEOUT` while webApi was still processing. Keep explicit client/request cancellation, bounded response sizes, retry bounds, and provider-originated timeout classification.

## Evidence

- Production release `1.0.4` logged `ai.capability_probe_failed` with HTTP 504 / `AI_TIMEOUT` while the multimodal strict-schema probe was still processing.
- Before PR #17, `loadConfig()` defaulted `BASKETRA_AI_TIMEOUT_MS` to `30000`, and `OpenAiCompatibleProvider.executeStructured()` used that value to abort the fetch.
- PR #17 merged as `77e09e215e409eb5f3d89d38a6ee31135befc553` and changed the application default to `0`; both supported Compose variants now force `BASKETRA_AI_TIMEOUT_MS: 0`, preventing stale host `.env` values from restoring the former 30-second deadline.
- `timeoutMs = 0` creates no provider timer. A positive value remains only as an explicit low-level/operator opt-in outside the supported Compose deployment contract.
- Provider HTTP 408/504 responses remain normalized to retryable `AI_TIMEOUT`; those responses are upstream-owned.
- After PR #17, Settings still described `AI_TIMEOUT` as a Basketra "configured time" failure, README and the Raspberry runbook still documented `30000`, and the direct Settings capability probe did not cancel its provider request when the browser/client disconnected.

## Decision

1. Keep PR #17 as the canonical timeout policy: no Basketra-owned inference deadline by default, and `0` in both supported Compose variants.
2. Keep a positive low-level timeout as an explicit operator/test opt-in rather than deleting the capability entirely; an opt-in is not an imposed product default.
3. Keep upstream HTTP 408/504 mapped to retryable `AI_TIMEOUT`.
4. Correct Settings and receipt-recovery copy so it attributes timeout failures to the upstream provider/webApi and states that Basketra applies no inference deadline by default.
5. Correct README, Raspberry runbook, and stable `spec.md` so they no longer instruct operators to use `30000` or claim a default AI deadline.
6. Cancel the Settings capability probe if its client connection closes before a response is completed. Propagate that cancellation through the canonical provider `AbortSignal` and do not log it as an upstream `AI_TIMEOUT`/provider failure.
7. Keep response-size caps, finite retries, one-slot AI serialization, OCR timeout, heartbeat timeout, body/storage limits, and container resource controls unchanged.
8. Supersede the divergent PR #18 rather than rebasing/force-pushing it over PR #17; implement this follow-up from the current `main` to preserve a single timeout policy owner.

## Acceptance criteria

- [x] Application AI timeout default is `0`.
- [x] Supported local and Raspberry Compose force `BASKETRA_AI_TIMEOUT_MS: 0`.
- [x] A zero provider timeout does not synthesize a wall-clock abort.
- [x] Explicit external cancellation remains authoritative.
- [x] Provider HTTP 408/504 remains retryable `AI_TIMEOUT`.
- [ ] Settings no longer says a Basketra configured timeout expired.
- [ ] Receipt AI recovery no longer implies Basketra imposed the timeout.
- [ ] README and Raspberry deployment examples use `BASKETRA_AI_TIMEOUT_MS=0` and explain ownership accurately.
- [ ] Stable `spec.md` records no default AI inference deadline while preserving unrelated OCR/heartbeat timeouts.
- [ ] Closing the Settings request cancels the in-flight provider capability probe.
- [ ] Client cancellation is not logged as `ai.capability_probe_failed`.
- [ ] Regression tests cover corrected timeout guidance and Settings-probe cancellation.
- [ ] Quality, changed-code coverage, Browser E2E, Security, resource budgets, container smoke, AMD64, ARM64, CodeQL, and PR visual evidence pass on the exact final head.
- [ ] No merge, release, GHCR publication, deployment, Raspberry mutation, migration, or secret change is performed from this PR.

## Security and privacy

Removing the default AI deadline does not relax payload or resource bounds. Provider responses stay byte-capped, retries stay finite, AI serialization stays bounded, and the container keeps CPU/memory/PID restrictions. The Settings probe uses only the repository-owned synthetic image and strict schema; cancellation introduces no new request input or credential flow.

A client disconnect must terminate the corresponding synthetic provider request so a dead browser does not leave an unbounded diagnostic operation occupying provider/browser capacity. Raw provider bodies, credentials, image bytes, prompts, schemas, and private network internals remain absent from application logs.

## Tests

- Existing `ai-timeout-policy` tests remain the canonical proof that zero means no self-abort and external cancellation remains authoritative.
- Browser diagnostics assert that `AI_TIMEOUT` states no default Basketra deadline.
- Receipt recovery unit tests assert the same ownership wording without leaking raw provider details.
- Operations-gateway integration tests abort a real in-flight Settings probe and verify the canonical provider transport is cancelled.
- Full repository and container gates remain blocking.

## Risk and rollback

With the supported default of zero, an upstream provider can remain active while its requesting client remains connected. That is intentional for browser-backed multimodal inference where latency is provider-owned. Client disconnect cancellation, one-slot AI serialization, bounded responses, finite retries, process/container limits, and upstream termination bound the remaining risk.

Rollback of this follow-up is a focused revert of diagnostics/docs/cancellation behavior. Rolling back PR #17 would reintroduce the unwanted default 30-second deadline and is not part of this plan.

## Status

PR #17 established the canonical zero-default policy. This follow-up is in progress on `agent/fix-ai-timeout-ownership-followup` to close stale UX/documentation and request-cancellation gaps. Exact-head CI and any production validation remain pending. No merge, release, publication, deployment, Raspberry mutation, migration, or secret change has been performed.
