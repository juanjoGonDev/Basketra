# Compact shopping rows and resilient offline PWA

## Request

Improve the installed Basketra PWA for real supermarket use:

- pending shopping-list items must be compact by default instead of permanently rendering every editable control;
- secondary item configuration must live behind an explicit accessible disclosure panel;
- an installed PWA that has been opened successfully before must start quickly when connectivity is absent or severely degraded;
- the service-worker cache revision must follow the same canonical release version injected into the container image instead of a manually incremented cache number;
- PWA artifact metadata must expose that same release version without changing the stable application identity;
- replace the current coarse cart artwork with one canonical, scalable SVG icon that remains legible as a small launcher icon and supports maskable use.

The Android system `Version` shown for a Chromium WebAPK is not controlled by a standard Web App Manifest `version` member. This change therefore does not claim to control Android's generated package version. It aligns Basketra-owned PWA/cache metadata with the image version and keeps the installed app identity stable.

## Evidence

Baseline: `b841518ce82f39a9edb73fdda09c2f48340237a0` on `main`.

- `src/web/lists.js` currently renders quantity, unit, variant, Store, move and more-actions controls permanently in `.ticket-item__controls`, which creates very tall rows on the user-provided 390 px Android screenshot.
- `src/web/modern.css` currently gives each pending row a second `controls` grid row and expands those controls to two columns on narrow screens.
- `src/web/sw.js` already precaches the application shell and falls back to cache offline, but every same-origin non-API GET is network-first. A weak connection can therefore keep a previously cached application waiting on a slow network attempt before the offline fallback is reached.
- `src/web/sw.js` uses the hand-maintained cache key `basketra-shell-v30`.
- the release workflow passes one canonical `BASKETRA_VERSION` build argument to the container image, and `src/operations/version.ts` already treats that environment variable as the runtime version source of truth.
- `src/web/manifest.webmanifest` has no stable `id` and only references `/icon.svg`; Web App Manifest has no standardized application `version` field consumed as Android `versionName`.
- `src/web/icon.svg` is scalable but uses a very coarse solid cart silhouette.
- the service worker intentionally does not cache `/api/` responses. Keeping data mutation and conflict resolution online avoids introducing an unreviewed offline-write source of truth in this focused change.

## Decision

### Compact shopping rows

Use progressive disclosure on the existing row rather than introducing another item editor or duplicating domain state.

A small progressive-enhancement module owns only the disclosure presentation. It observes rendered pending rows, preserves expanded item ids across list re-renders, and adds one native button with `aria-expanded`/`aria-controls`. The existing canonical controls remain the only editable controls; they move into the disclosed region rather than being cloned.

Collapsed rows retain the high-frequency completion action, product identity, latest price context, line total and a compact quantity summary. Quantity stepping remains a quick action. Unit, saved variant/size, Store, ordering and secondary actions are disclosed on demand.

The disclosure must be keyboard operable, have a minimum touch target, preserve focus, expose its state to assistive technology and work from 320 px upward without page overflow.

### Offline and degraded connectivity

Preserve the existing security boundary: `/api/` stays uncached and there is no offline mutation queue in this PR.

Change shell fetch behavior by request class:

- known same-origin shell assets: cache-first with background revalidation, so an already installed/opened PWA does not wait for a poor connection before showing its UI;
- navigations/application routes: bounded network-first. If the network does not respond within a short deterministic budget, return the cached navigation/index shell immediately and let the user see Basketra's disconnected/degraded state;
- unknown same-origin GET assets: network-first with cache fallback;
- `/api/`, non-GET, cross-origin and unsupported URL schemes: bypass the service worker exactly as today.

The offline guarantee is therefore **application-shell availability after one successful install/cache population**, not full offline editing. Full offline writes would require an IndexedDB/outbox conflict model and is explicitly excluded from this focused PR.

### Version ownership

`BASKETRA_VERSION` remains the only release-version owner.

`Dockerfile` makes the existing build argument available to the build stage. `scripts/build.mjs` validates the value and stamps generated PWA artifacts in `dist/`:

- service-worker cache namespace;
- non-standard Basketra-owned manifest metadata for diagnostics.

The source files retain deterministic development placeholders/defaults. The manifest receives a stable `id` that never contains the version, preventing a release from becoming a new installed application identity.

### Icon

Keep a single `src/web/icon.svg` source. Use a simple Basketra mark built from scalable vector paths, with safe inset for maskable cropping, strong contrast, valid `viewBox`, and no external font/image dependency. The manifest continues to reference the SVG with `any maskable` purpose.

## Scope

Included:

- shopping-list row density/disclosure presentation;
- shell startup under offline/degraded connectivity;
- build-time PWA version stamping from image version;
- canonical SVG icon and manifest identity/metadata;
- focused unit/E2E/Playwright regression coverage and documentation.

Excluded:

- offline writes, background sync or a second local shopping-list database;
- caching authenticated/private API JSON beyond the existing shell policy;
- changing public API contracts, SQLite schema, shopping calculations, realtime semantics, image release policy or Android WebAPK package-version generation;
- native/Capacitor/TWA migration.

## Acceptance

1. A pending shopping item is compact by default on 320 px and 390 px viewports; unit, variant/size, Store, order and secondary controls are not permanently expanded.
2. Each compact row has an explicit native disclosure control with accurate `aria-expanded` and `aria-controls` state.
3. Expanding exposes the existing canonical controls; collapsing does not lose values, and row re-rendering preserves the expanded item when it still exists.
4. Completion and quantity increment/decrement remain directly reachable without opening the panel.
5. No horizontal page overflow is introduced at 320 px, 390 px or desktop widths.
6. Existing swipe, edit/delete alternatives, multi-select and realtime convergence remain intact.
7. After the shell has been cached once, known shell assets are served cache-first and do not wait on a degraded network response.
8. Navigation falls back to the cached app shell after a bounded network wait; fully offline navigation still loads the shell.
9. `/api/`, cross-origin, unsupported-scheme and non-GET requests remain outside shell caching.
10. Successful background refreshes update shell cache without making cache-write failure fatal.
11. Production `dist/web/sw.js` cache namespace contains the validated `BASKETRA_VERSION` passed to the image build.
12. Production `dist/web/manifest.webmanifest` exposes the same Basketra release version while retaining a stable version-independent `id`.
13. Invalid build-time version input fails closed rather than producing malformed PWA metadata.
14. `icon.svg` is a single scalable vector source with a `0 0 512 512` viewBox, safe maskable inset and no raster/embed dependency.
15. Automated tests cover disclosure collapsed/expanded behavior, mobile geometry, shell cache strategy, degraded navigation fallback, cache version stamping and manifest/icon contract.
16. Full `pnpm quality`, relevant Playwright/browser checks and required GitHub CI pass on the exact PR head before completion.

## Tests

- Unit: service-worker install/activate, cache-first shell asset, background refresh, degraded navigation timeout, offline navigation, ignored request classes, cache-write rejection.
- E2E/static contract: manifest stable id/version placeholder, SVG contract, generated version stamping.
- Browser/Playwright: 390 px and 320 px compact shopping row, disclosure semantics, expanded controls, quantity quick action, no horizontal overflow; existing realtime Store flow remains covered.
- Build: run production build with an explicit semantic `BASKETRA_VERSION` and assert stamped artifacts.
- Quality: project canonical `pnpm quality` plus browser suite/CI as configured.

## Risks

- Chromium's generated WebAPK `Version` can remain unrelated to Basketra semver; the manifest extension is diagnostic metadata only. The stable manifest `id` must not be versioned as a workaround.
- A shell-only offline strategy means server data and writes still require connectivity. The UI can open immediately, but uncached API-driven content cannot be promised offline.
- Cache-first static assets must revalidate in the background so releases do not stay stale indefinitely; cache namespaces are release-versioned to make activation deterministic.
- Progressive enhancement must not duplicate the canonical item controls or interfere with swipe/multi-select event ownership.

## Rollback

Revert the focused frontend/PWA/build/test commit. There are no database migrations, API changes, dependencies or persisted-domain transformations. A rollback installs the previous service-worker cache namespace on the next deployed release.

## Delivery

Branch: `agent/feat-pwa-offline-list-density`.

Open a normal, non-draft PR against `main`; do not merge, release or deploy without explicit user approval.

## Status

Specification recorded from repository evidence. Implementation and validation are in progress.
