# Service worker cache and receipt pool recovery

## Request

Continue PR #32 after two runtime regressions observed in the deployed browser:

1. `sw.js` throws `TypeError: Failed to execute 'put' on 'Cache': Request scheme 'chrome-extension' is unsupported`.
2. Freshly uploaded receipt photos remain labelled as waiting for a pool slot, and a new OCR run can remain queued after the service/backend has been restarted.

## Evidence

- `src/web/sw.js` intercepts every non-API GET request regardless of URL scheme/origin and writes every successful response through `cache.put(event.request, copy)`. Cache Storage does not accept `chrome-extension://` requests.
- `src/web/receipts.js` creates every capture page state as `pending`, so an uploaded but not-yet-started capture is rendered as `En espera de un hueco del pool` even when no pool work exists.
- The browser scheduler owns a process-wide `activePageCount`. `abortPageWork()` increments `runToken` and aborts old requests but does not synchronously release that counter. A previous request that does not settle after abort can therefore keep the next run at the two-slot ceiling indefinitely.
- Duplicate-task detection also considers tasks from old `runToken` values, so stale work can block the same capture in a new run.
- The server-side receipt queue is reconstructed with a new `ReceiptExtractionService` on service restart; the observed `pending` UI can therefore be caused entirely by stale browser scheduler state.

## Decision

### Service worker

Restrict the application shell fetch strategy to same-origin `http:`/`https:` GET requests outside `/api/`. Ignore unsupported schemes and cross-origin requests instead of passing them to Cache Storage or the app-shell fallback. Bump the shell cache revision with the changed frontend assets.

### Receipt page scheduler

- Add a `ready` page status for stored captures that have not been enqueued.
- Transition `ready -> pending` only when `enqueueCapture()` actually places a page in the current run queue.
- Derive occupied browser pool slots from `activePageTasks` scoped to the current `runToken`; remove the mutable global `activePageCount` owner.
- Scope duplicate-task checks to the current run so stale tasks cannot reserve a capture slot after restart/cancel/retry.
- Preserve old task isolation through the existing `runToken` + page-version guards; old tasks may finish later but cannot mutate the current page state.

## Acceptance

- `chrome-extension://` and cross-origin fetches are ignored by the service worker and never reach `cache.put` or the SPA fallback.
- Same-origin HTTP(S) shell requests remain network-first with cache/offline fallback; `/api/` remains uncached.
- A newly uploaded capture renders as ready, not as waiting for a pool slot.
- Starting local OCR puts at most two current-run pages into active work and leaves additional pages genuinely pending.
- A second run starts immediately even when two promises from a previous run never settle after cancellation.
- Stale tasks cannot mutate current page state or consume current-run concurrency.
- Existing cancellation, retry, background-job, AI and receipt assembly behavior remains intact.
- Regression coverage includes service-worker scheme/origin filtering and a browser scenario with two intentionally non-settling stale OCR requests.

## Checks

- `pnpm test`
- `pnpm quality`
- Browser E2E
- Pull Request Quality
- CodeQL Advanced
- Publish PR visual evidence

## Rollback

Revert the focused service-worker/scheduler commits. No database, API, dependency or migration change is involved.

## Delivery

Branch: `agent/ui-android-native-redesign`.

Atomic Conventional Commits. Keep PR #32 open and unmerged pending final visual review.

## Status

Root cause identified from head `4796485e8684363d036893f597b13f991a4962a4`. Regression tests pending.