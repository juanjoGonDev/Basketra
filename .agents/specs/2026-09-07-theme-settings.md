# Theme preference settings

## Request

Allow the Basketra user to choose the application appearance from Settings and persist that choice. The reported Android screenshot also shows a mixed light/dark rendering where the page background is light while text and surfaces use dark-theme tokens, so the change must provide a deterministic explicit theme override rather than relying only on the device preference.

## Evidence

- `src/web/styles.css` and `src/web/modern.css` expose the application palette, while the UI previously depended directly on `prefers-color-scheme` with no user-owned override.
- `src/web/index.html` declares `color-scheme: light dark` but has no user-selectable appearance control.
- Settings are organized into General, IA, Diagnóstico, Datos and Avanzado tabs. The General tab currently contains runtime/version information only.
- The supplied Android screenshot shows an inconsistent mixed palette: a light main canvas combined with near-light text and dark header/cards. CI reproduced the mechanism: `inventory.css` is injected globally and its mobile `body` rule hard-coded `#fbfdfc`, overriding the dark semantic canvas while the remaining components stayed dark.
- Theme choice is a per-client UI preference, not an operator/runtime service setting. Persisting it in browser storage avoids changing the appearance of every device when one device changes its own theme.

## Decision

1. Add three appearance choices: `Sistema`, `Claro`, and `Oscuro`.
2. `Sistema` remains the default and continues following `prefers-color-scheme`.
3. The early theme script always materializes the effective root `data-theme` (`light` or `dark`) before styles are parsed. In `Sistema`, media changes recompute that effective value immediately, so the CSS palette has one deterministic input and navigation/reload does not flash or mix themes.
4. Persist the choice in same-origin `localStorage` under one dedicated key. This is intentionally separate from SQLite runtime settings because appearance is device/browser-specific state rather than server runtime configuration.
5. The effective root theme sets `color-scheme: only light` or `only dark` so browser-native controls and automatic darkening cannot create a mixed palette.
6. Add the Appearance card to Settings > General after the existing settings tab shell is created; do not create another settings architecture.
7. Keep `modern.css` as the single owner of the semantic light/dark palette. `theme.css` owns only the Appearance control styling; it must not duplicate palette literals. Globally injected shell CSS must consume semantic tokens instead of hard-coded light colors.
8. The selector is keyboard-operable native radio input UI, applies immediately, and reports that the preference is saved on the current device.

## Acceptance

- Settings > General exposes an `Apariencia` section with `Sistema`, `Claro`, and `Oscuro` choices.
- The current choice is reflected with native radio semantics and is fully keyboard operable.
- Changing the choice applies immediately without reload.
- Reloading or navigating keeps the explicit choice.
- `Sistema` follows the current OS/browser preference and updates the effective root `data-theme` when the media preference changes.
- Explicit `Claro` remains light even when `prefers-color-scheme: dark` is active.
- Explicit `Oscuro` remains dark even when `prefers-color-scheme: light` is active.
- The effective theme sets a deterministic `color-scheme` to prevent browser auto-darkening from mixing palettes.
- Home, Settings, header, cards, text and bottom navigation use one coherent palette after an explicit choice.
- The control remains usable at 320 px without horizontal overflow and with touch targets at least 44 px high.
- No backend API, database migration, dependency, or public contract is added.
- New theme assets are served by the existing static-asset boundary and included in the service-worker application shell.

## Tests

- Browser regression: explicit light overrides emulated dark, persists through reload and keeps coherent readable tokens.
- Browser regression: explicit dark overrides emulated light and persists through reload.
- Browser regression: returning to system persists `system`, materializes the current effective root theme and follows subsequent media preference changes.
- Browser regression: Settings appearance control has no horizontal overflow at 320 px.
- Unit/static contract: index loads the theme assets before application modules, static allowlist includes them, and the service-worker shell caches them.
- Canonical `pnpm quality`, Browser E2E, security, container and architecture checks remain authoritative.

## Risks

- Browser storage can be unavailable or blocked. The implementation must fail safely to `Sistema` and keep the application usable.
- Some Android browsers expose non-standard force-dark settings. `color-scheme: only light|dark` plus explicit semantic tokens is the strongest standards-based application control; browser extensions or vendor-level forced transformations remain outside application control.
- Route styles injected globally can reintroduce hard-coded light colors that override the semantic canvas. Contract coverage now protects the known Inventory shell boundary, while future global shell styling must use semantic tokens.

## Rollback

Revert the theme assets, their index/static-shell registrations and tests. No persisted server data or migration requires rollback; stale browser preference data is harmless when the feature is absent.

## Delivery

- Branch: `agent/feat-theme-settings`
- Target: `main`
- Merge, release and deploy require separate authorization.

## Status

Implementation in progress. Exact-head CI and final responsive/visual review remain mandatory before completion.
