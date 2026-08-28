# Client request throttle and progressive receipt recovery

## Request

Fix the receipt UI regressions observed after durable receipt processing landed:

- the browser can issue repeated requests to the same API endpoint multiple times per second;
- AI provider diagnostics expose transport/probe success without clearly stating whether the configured capability is usable;
- durable OCR checkpoints are hidden while AI verification is still running;
- entering manual review hides recovery/retry choices that must remain available;
- HTTP request throttling should be a default browser policy rather than an endpoint-specific patch.

## Evidence

- Production browser evidence shows bursts of repeated `/api/v1/settings/ai-provider` requests while a receipt AI job is running.
- `src/web/api.js` and `src/web/operations.js` independently fetch AI provider settings and therefore have no single request-rate owner.
- `src/web/api.js` installs a subtree `MutationObserver`; its callback can repeatedly call `enhanceProviderHealth()`, while independent operational refreshes also load the same endpoint.
- Durable OCR already exists in `ReceiptDurableJobStore.pages[].ocr`, but the public receipt job response only exposes terminal extraction and remote response IDs.
- Failed AI recovery marks `hasOcrDraft: true`, proving the server owns reusable OCR even though the UI cannot render it before terminal completion.
- Browser E2E on implementation head `e725e825783fe2dd49f7bf58f0e46911353854c2` passed all 60 scenarios, including progressive OCR reload, heartbeat recovery, shopping-list coalescing behavior and PDF manual recovery.
- Quality, Security, CodeQL, container smoke, linux/amd64 and linux/arm64 all passed on implementation head `e725e825783fe2dd49f7bf58f0e46911353854c2`.

## Decision

Create one browser HTTP request coordinator as the SSOT for ordinary `fetch` traffic.

Default bucket identity is `HTTP method + URL pathname`; query parameters and fragments do not create a new bucket. Example: `GET /api/v1/products/suggestions?q=a` and `GET /api/v1/products/suggestions?q=b` share a request-rate bucket.

Default policy:

- no endpoint bucket may start more than one ordinary HTTP request per second unless a documented centralized override exists;
- safe reads (`GET`/`HEAD`) may coalesce compatible in-flight calls instead of producing duplicate traffic;
- mutations are never dropped: they are queued/serialized within their bucket and retain call order;
- aborting one consumer must not cancel another consumer sharing/coalescing a request;
- failures release the bucket deterministically and do not create retry loops;
- `EventSource` realtime is not routed through fetch throttling, but reconnect behavior remains bounded and event-driven rather than polling;
- browser modules must consume the coordinator instead of calling `fetch()` directly for application API traffic.

Expose bounded progressive durable receipt state from the existing SQLite owner so the UI can render OCR/deterministic items while AI remains pending/running. Do not persist a second OCR copy in browser storage.

Provider UI must distinguish:

- request/probe execution status;
- configured provider/capability usability.

A successful transport/probe result must render an explicit user-facing usable/OK state when the required capability contract passed, rather than merely displaying an internal `status: success` concept.

Manual review is an additive recovery path. Choosing it must not remove retry/provider-recovery controls while the failed durable job remains recoverable.

## Acceptance

- [x] This spec is the first commit on the branch.
- [x] One browser request coordinator owns ordinary application HTTP traffic.
- [x] Bucket key is method + pathname and ignores query parameters/fragments.
- [x] Default per-bucket start rate is at most one request per second.
- [x] Concurrent/repeated compatible GETs are coalesced or delayed so network evidence never shows bursts for the same bucket.
- [x] POST/PUT/PATCH/DELETE requests are queued rather than dropped and preserve order.
- [x] Abort/error paths cannot leave a bucket permanently locked or cause duplicate replay.
- [x] Direct application `fetch()` usages outside the coordinator are removed or explicitly documented as non-application transport exceptions.
- [x] `/api/v1/settings/ai-provider` no longer receives multiple browser requests per second during receipt processing/settings rendering.
- [x] Tests prove query variants share the same throttle bucket.
- [x] Tests prove different endpoint paths use independent buckets.
- [x] Tests prove mutation requests are serialized and not lost.
- [x] Provider health UI separates probe execution from usable capability state and renders an explicit OK/usable result when appropriate.
- [x] Receipt job API exposes bounded progressive OCR/deterministic page evidence from the durable SQLite checkpoint while AI is non-terminal.
- [x] Receipt UI renders available OCR-derived items/text while AI verification/correction is still running and survives reload without replay.
- [x] Progressive OCR exposure does not include provider credentials, filesystem paths, unrestricted payloads, or a browser-authoritative OCR copy.
- [x] Selecting manual review keeps retry/recovery options visible and usable.
- [x] Regression tests cover manual review + retry coexistence.
- [x] Existing durable reload, orphan adoption, fail-closed recovery and AI concurrency=1 contracts remain green.
- [x] `pnpm quality`, browser E2E/changed-code coverage, security, CodeQL and container checks are green on the final exact head.

## Risks

- A global one-second bucket can add latency to intentionally rapid repeated mutations; queueing avoids data loss but UX must remain observable.
- Coalescing reads with different query parameters can only be used when response semantics permit it; the rate bucket ignores query parameters, but response promises must not incorrectly reuse data for a different query. Query variants may wait on the same bucket but must execute independently unless their full request identity is equivalent.
- Progressive OCR is receipt content and must only be returned through the existing private application API; logs/telemetry must not copy it.
- Manual review must not mutate or invalidate the durable OCR checkpoint merely by being opened.

## Tests

- Deterministic unit tests for bucket normalization, rate scheduling, coalescing, mutation ordering and abort/error release using controlled time (no sleeps).
- Browser regression for `ai-provider` request count/rate.
- Integration test for progressive job response while OCR exists and AI is pending/running.
- Browser regression for progressive OCR rendering during AI.
- Browser regression that manual mode keeps retry/recovery controls visible.
- Existing receipt durable and concurrency suites.

## Rollback

Revert the request coordinator and progressive job-response/UI commits independently. Durable SQLite schema/checkpoints remain unchanged; no migration or destructive operation is required.

## Delivery

New non-draft PR from `agent/fix-client-request-throttle` to `main`. Do not merge, release or deploy without explicit approval.

## Status

Implementation complete. The PR is ready for review once CI for this checklist commit is green. No merge, release or deploy has been performed.
