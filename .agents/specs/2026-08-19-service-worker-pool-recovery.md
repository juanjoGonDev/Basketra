# Service worker cache and receipt pool recovery

## Request

Continue PR #32 after two runtime regressions observed in the deployed browser:

1. `sw.js` throws `TypeError: Failed to execute 'put' on 'Cache': Request scheme 'chrome-extension' is unsupported`.
2. Freshly uploaded receipt photos remain labelled as waiting for a pool slot, and a new OCR run can remain queued after the service/backend has been restarted.

## Evidence

- `src/web/sw.js` intercepted every non-API GET request regardless of URL scheme/origin and wrote every successful response through `cache.put(event.request, copy)`. Cache Storage does not accept `chrome-extension://` requests.
- `src/web/receipts.js` created every capture page state as `pending`, so an uploaded but not-yet-started capture rendered as `En espera de un hueco del pool` even when no pool work existed.
- The browser scheduler owned a process-wide `activePageCount`. `abortPageWork()` incremented `runToken` and aborted old requests but did not synchronously release that counter. A previous request that did not settle after abort could therefore keep the next run at the two-slot ceiling indefinitely.
- Duplicate-task detection considered tasks from old `runToken` values, so stale work could block the same capture in a new run.
- The server-side receipt queue is reconstructed with a new `ReceiptExtractionService` on service restart; the observed `pending` UI could therefore be caused entirely by stale browser scheduler state.

## Decision

### Service worker

Restrict the application shell fetch strategy to same-origin `http:`/`https:` GET requests outside `/api/`. Ignore unsupported schemes and cross-origin requests instead of passing them to Cache Storage or the app-shell fallback. Bump the shell cache revision with the changed frontend assets. Treat cache writes as auxiliary: a rejected `cache.put()` must not reject the fetch response or create an unhandled promise.

### Receipt page scheduler

- Add a `ready` page status for stored captures that have not been enqueued.
- Transition `ready -> pending` only when `enqueueCapture()` actually places a page in the current run queue.
- Derive occupied browser pool slots from `activePageTasks` scoped to the current `runToken`; remove the mutable global `activePageCount` owner.
- Scope duplicate-task checks to the current run so stale tasks cannot reserve a capture slot after restart/cancel/retry.
- Preserve old task isolation through the existing `runToken` + page-version guards; old tasks may finish later but cannot mutate the current page state.
- Preserve the existing defensive fallback for unknown future page states: they render as `Pendiente`, not as `Lista`.

## Acceptance

- `chrome-extension://` and cross-origin fetches are ignored by the service worker and never reach `cache.put` or the SPA fallback.
- Same-origin HTTP(S) shell requests remain network-first with cache/offline fallback; `/api/` remains uncached.
- A cache-write rejection cannot reject an otherwise successful network fetch.
- A newly uploaded capture renders as ready, not as waiting for a pool slot.
- Starting local OCR puts at most two current-run pages into active work and leaves additional pages genuinely pending.
- A second run starts immediately even when two promises from a previous run never settle after cancellation.
- A same-run retry of one cancelled capture waits behind its still-settling predecessor instead of starting duplicate work.
- Stale tasks cannot mutate current page state or consume current-run concurrency.
- Unknown future page states continue to fail closed as pending progress.
- Existing cancellation, retry, background-job, AI and receipt assembly behavior remains intact.
- Regression coverage includes service-worker scheme/origin/cache-write filtering, two intentionally non-settling stale OCR requests, and same-run duplicate retry protection.

## Checks

Validated on implementation head `c0e12d5299ba2ee1f420da56ea2ff67ac89c8e48`:

- Pull Request Quality run `32239525985`: Quality, Browser E2E, Security, container smoke, linux/amd64 and linux/arm64 passed.
- Browser E2E job `96026829481`: 43/43 tests passed in Chromium.
- Browser changed-code coverage: 16 lines, 3 functions and 18 branches at 100%.
- The stale-run recovery test passed with two intentionally non-settling OCR requests.
- The same-run duplicate retry test passed.
- Service-worker unit coverage includes unsupported schemes, cross-origin requests, `/api/`, cache-write rejection, offline cache and SPA fallback.
- CodeQL Advanced run `32239526047`: passed.
- Publish PR visual evidence run `32239525930`: passed and published evidence from the exact validated head.

## Implementation

- `25860303812ca3680ab1f58872927c4d733a4c1b` — `fix(pwa): ignore unsupported cache requests`.
- `56e235b9ffae35be73fb35923c60fd6417503b0d` — `fix(receipts): isolate pool slots per run`.
- `09c157d7d7c3005f4389b66a6d56f992643e8bfc` — `test(pwa): cover cache write failure`.
- `ae828695f02ecc1b3276ed283253621421c1f45d` — `fix(receipts): keep unknown states pending`.
- `9a39af6258159dbf4c3fdd6d5fff77dd030c84d2` — `test(receipts): keep unknown state through upload`.
- `c0e12d5299ba2ee1f420da56ea2ff67ac89c8e48` — `test(receipts): cover queued same-run retry`.

## Rollback

Revert the focused service-worker/scheduler/test commits. No database, API, dependency or migration change is involved.

## Delivery

Branch: `agent/ui-android-native-redesign`.

Atomic Conventional Commits. Keep PR #32 open and unmerged pending final visual/runtime review.

## Status

Implementation and regression coverage complete. Exact implementation head `c0e12d5299ba2ee1f420da56ea2ff67ac89c8e48` passed the full PR quality matrix, CodeQL and visual-evidence publication. This documentation commit is the final branch-head change and must retain the same green required checks before the PR is considered ready for user review.
