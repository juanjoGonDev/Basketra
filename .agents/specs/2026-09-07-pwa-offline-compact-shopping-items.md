# Compact shopping rows, resilient PWA shell and release identity

## Request

Reduce Shopping List pending-row height by keeping the default item presentation compact, moving configuration into an expandable panel, make the installed PWA usable when connectivity is unavailable or severely degraded after a successful install, synchronize the PWA runtime/cache identity with the released container version, and improve the canonical SVG application icon.

## Evidence

- Shopping List pending rows currently render quantity, unit, saved-product variant, Store, reorder controls and overflow actions permanently beneath each item, producing very tall mobile rows.
- `ticketItem()` in `src/web/lists.js` is the canonical pending-row renderer; `src/web/modern.css` owns its responsive layout.
- Swipe completion/delete is already a progressive enhancement with visible button/keyboard equivalents and must remain intact.
- The current service worker precaches the complete static shell, rejects unsupported protocols and API requests correctly, but uses network-first for every same-origin static GET. On a weak connection this can stall before cache fallback even though the shell is already installed.
- Browser coverage already proves a fully offline reload after the service worker has installed.
- Runtime image version is already canonical in `BASKETRA_VERSION`, exposed as `metadata.application.version` by the operations gateway and populated by the verified GHCR publication workflow.
- Web App Manifest has no standard member that controls Android/WebAPK `versionName`; Chrome/Android owns that package metadata for browser-installed PWAs. Basketra can synchronize its own PWA service-worker/cache identity and visible diagnostics with the image version, but cannot guarantee the Android App Info version shown by the OS without introducing a TWA/native package.
- `src/web/icon.svg` is already the single PWA/favicon source, but the current mark is a basic filled cart and can be improved without adding another icon library or raster source.

## Decision

1. Keep the existing Shopping List row, swipe model, API contracts and realtime invalidation owners.
2. Make each pending item a compact primary row showing completion, product identity, concise quantity/unit + effective Store/price context, estimated total and one explicit configuration disclosure button.
3. Move quantity stepper, unit, saved-product/package selector, Store override, reorder buttons and existing swipe-action toggle into an expandable settings region.
4. Keep disclosure state in the Shopping List model so realtime rerenders and successful inline mutations do not unexpectedly collapse a row the user is editing.
5. Use native button semantics with `aria-expanded` + `aria-controls`; do not use an interactive `summary` containing nested controls.
6. Preserve 44 px touch targets, keyboard operation, visible focus, swipe alternatives, multi-select behavior and no horizontal page overflow at 320/390 px.
7. Change the service worker from network-first to cache-first for already precached same-origin shell resources and application navigation. Refresh cached resources in the background when online; APIs remain network-only and are never placed in the shell cache.
8. Preserve the current install-time complete-shell precache. First installation still requires one successful online load; offline guarantees apply after the service worker has installed.
9. Register the service worker with the canonical runtime image version from `metadata.application.version`. The worker derives its cache namespace from that version, so a new image version installs a new shell cache and removes obsolete Basketra shell caches.
10. If runtime metadata cannot be reached because the device is offline, do not unregister or replace the already installed worker; the existing cached shell remains authoritative.
11. Do not add an invented Web App Manifest version contract. Android App Info may continue to show browser-managed package metadata. Record this limitation explicitly.
12. Replace `src/web/icon.svg` with a cleaner scalable Basketra mark using one SVG source, stable `viewBox`, safe maskable padding and existing brand colors.
13. No backend domain/API/database/dependency change.

## Acceptance

1. A pending Shopping List row is compact by default and does not permanently render the configuration grid.
2. The compact row remains understandable without opening settings: product name, quantity/unit, effective Store/price context and line estimate are available.
3. The explicit configuration button has a descriptive accessible name and correct `aria-expanded`/`aria-controls` state.
4. Expanding exposes quantity, unit, package/product variant, Store, reorder and existing item actions; collapsing hides them without losing server state.
5. Expanded state survives a realtime rerender and an inline quantity/unit/Store update for the same item.
6. Multi-select rows remain compact and unchanged in semantics.
7. Shopping List passes no-horizontal-overflow checks at 320 px, 390 px and desktop.
8. The installed shell reloads while fully offline after a successful service-worker install.
9. With the shell already cached, a navigation/static request does not wait for a failing network request before serving cached content.
10. Same-origin API traffic, non-GET traffic, cross-origin requests and unsupported protocols remain outside service-worker caching.
11. A runtime image version change changes the service-worker script identity/cache namespace and old Basketra shell caches are removed on activation.
12. Existing local development without a release version remains valid.
13. The canonical manifest/favicon continues to point to a single SVG icon; the new icon remains valid and maskable.
14. No new dependency, polling, backend contract or destructive migration is introduced.
15. Relevant unit, browser, changed-code coverage, build, security and repository CI gates pass.

## Checks

- Unit: service-worker install/cache cleanup, cache-first shell, background refresh success/failure, network miss, navigation fallback, API/non-GET/cross-origin/unsupported-protocol bypass and versioned cache identity.
- Unit/static: Shopping List compact disclosure markup/accessibility contract and canonical SVG/manifest contract.
- Browser: 320/390/desktop compact row geometry, expand/collapse, inline mutation persistence, realtime rerender persistence, keyboard disclosure, swipe regression and offline reload.
- Existing full `pnpm quality`, Browser matrix, container gates and CodeQL remain authoritative in CI.

## Rollback

- UI changes are presentation-only; removing the disclosure layout restores the previous always-expanded controls without data migration.
- Service-worker cache names are disposable derived state. Rolling back installs the prior worker on the next successful online update and activation cleanup removes superseded Basketra shell caches.
- Icon replacement is a single asset rollback.
- No persisted domain data is modified.

## Delivery

Branch: `agent/feat-pwa-offline-compact-items`

Status: specified; implementation and exact-head validation pending.
