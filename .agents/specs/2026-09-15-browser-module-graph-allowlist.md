# Browser module graph must stay served and precached

## Request

Pull Request Quality failed on every one of the 56 Browser shards for the durable ticket review
branch. Diagnose the aggregate failure and restore a green exact-head pipeline without removing
coverage.

## Evidence

- Run `35001435376` on head `7538848c3a9d441422f5f101ef041b9130afcff2`: 56/56 `🌐 Browser` shards
  failed at the `Run Chromium shard` step, plus the `✅ CI complete` aggregate. Every other job
  passed. `🌐 Browser coverage` was skipped because it needs the shards.
- The preceding head `a6afa1e85672760d414b58ab0eb9af07e256059a` (run `34893828930`) failed 39/56
  shards, so the last commit widened the failure from most specs to all of them.
- `src/web/receipt-page-state.js` was introduced by that commit and is imported statically by
  `src/web/receipt-state.js` and `src/web/receipt-lifecycle.js`, which `app.js` reaches through
  `receipts.js`.
- `src/api/server.ts` serves a browser asset only when `STATIC_ASSETS` contains its name, and the
  new module was added to neither `src/api/static-assets.ts` nor the `SHELL` list in
  `src/web/sw.js`. A local run of the prebuilt browser runtime reproduced `GET
  /receipt-page-state.js` returning `404` while every other module returned `200`.
- A browser ES module graph is all-or-nothing: one unserved local import stops every module in the
  graph from evaluating, so `app.js` never ran and the whole interface stayed inert. That is why
  receipt-unrelated shards (bootstrap isolation, theme, inventory layout, shared controls) failed
  too, and why all 56 shards produced evidence artifacts rather than failing to start.
- `tests/integration/web-assets.test.ts` only asserted that assets listed in the service-worker
  `SHELL` are served. Because the new module was missing from `SHELL` as well, no existing gate
  could observe the omission.
- `.agents/specs/2026-09-12-frontend-component-boundary.md` already requires that all browser
  modules are served from the application and precached by the existing service worker.

## Scope

- Register `receipt-page-state.js` in the explicit static allowlist.
- Precache `/receipt-page-state.js` in the service-worker shell so an installed PWA can still boot
  offline, keeping shell and allowlist in parity.
- Add a regression gate that walks the browser module graph from the `index.html` entry scripts over
  HTTP and requires every reachable module to be served with the correct content type and to be
  precached by the shell.
- No product behavior, API, schema or dependency change.

## Decisions

1. The fix registers the module in both owners instead of loosening the allowlist. The explicit
   allowlist and the versioned shell cache are the intended security and offline boundaries.
2. The regression gate walks the graph through HTTP responses rather than reading `src/web` from
   disk, so it validates what a browser actually receives, including the allowlist decision.
3. The gate asserts precaching as well as availability, because a served-but-uncached boot module
   would still break the offline PWA contract silently.
4. Spec files were not migrated or deleted: an audit of every `#id`, `.class` and `[data-*]`
   selector used by `tests/browser` found no reference that the current interface no longer
   produces, so the shard failures were not stale selectors.

## Acceptance

- Every module reachable from the `index.html` entry scripts is served with `200` and its expected
  content type, including `/receipt-page-state.js`.
- Every reachable module is present in the service-worker `SHELL`.
- Removing either the allowlist entry or the shell entry fails
  `tests/integration/web-assets.test.ts`.
- `pnpm quality` passes, including the 100% coverage gates for `src/web/sw.js`.

## Rollback

Revert the allowlist entry, the shell entry and the added integration assertions. The module graph
returns to serving `404` for `/receipt-page-state.js` and every Browser shard fails again.
