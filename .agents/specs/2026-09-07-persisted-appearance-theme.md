# Persisted appearance theme

## Request

Add an Appearance setting so the single Basketra operator can explicitly choose the application theme and keep that choice across reloads/restarts.

The supplied Android screenshot shows a mixed palette on Home: the app bar, quick-action cards and bottom navigation are dark while the page background remains light and the hero copy becomes extremely low contrast. The current frontend derives both light and dark palettes only from `prefers-color-scheme`, so the operator has no reliable override when the browser/device theme negotiation produces an unusable result.

## Evidence

- `src/web/styles.css` and `src/web/modern.css` both define light defaults and dark overrides through `@media (prefers-color-scheme: dark)`.
- `src/web/index.html` advertises `color-scheme: light dark` but exposes no manual theme control.
- `src/infrastructure/runtime-settings.ts` is the canonical persisted owner for operator-adjustable settings and already backs the Settings UI through `GET/PUT /api/v1/settings/runtime`.
- `AGENTS.md` explicitly requires operator-adjustable runtime settings to use the existing persisted runtime-settings boundary when practical.
- Basketra is a single-user LAN/VPN application, so one persisted instance appearance preference is consistent with the current deployment model.

## Scope

### Included

- three explicit appearance values: `system`, `light`, and `dark`;
- SQLite persistence through the existing `runtime_settings` row;
- server-side validation and public projection through the existing runtime-settings API;
- an accessible Appearance control in Settings > General;
- immediate application after a successful save;
- first-render application from the persisted server setting so reloads do not depend on a second browser-side source of truth;
- explicit CSS selectors for manual light/dark overrides while preserving `prefers-color-scheme` only for `system`;
- regression coverage for persistence, invalid values, API projection, rendered application shell, manual overrides, system fallback, mobile layout, and contrast-sensitive Home rendering.

### Excluded

- a new theme library or state manager;
- per-device/per-browser theme profiles;
- arbitrary custom colors;
- redesigning unrelated screens;
- changes to deployment, release, merge, secrets, or protected branches.

## UX decision

Settings > General will expose a labelled `Tema` select with:

- `Sistema` — follows the device/browser preference;
- `Claro` — forces the complete light token set;
- `Oscuro` — forces the complete dark token set.

The selection is part of the existing runtime settings form and uses the existing `Guardar cambios` action. Saving applies the returned canonical value immediately. A failed save leaves the current theme unchanged and surfaces the existing inline error state.

## Data and rendering decision

SQLite remains authoritative. Add one non-destructive migration that adds `theme TEXT NOT NULL DEFAULT 'system'` with an enum check to `runtime_settings`.

The HTML shell is rendered with `data-theme="light"` or `data-theme="dark"` when the persisted value is explicit. `system` omits the attribute. This prevents an initial flash or a conflicting local-storage copy while retaining the existing static shell architecture.

CSS uses the explicit attribute as the highest-priority selector. The media-query dark palette applies only when no explicit theme attribute exists. `color-scheme` is also pinned to the chosen manual mode so native controls do not independently choose the opposite palette.

## Acceptance

- A `Tema` setting is visible and keyboard-operable in Settings > General.
- `Sistema`, `Claro`, and `Oscuro` are the only accepted values.
- The selected value persists in SQLite and survives a new `RuntimeSettingsStore` instance/server restart.
- Invalid or unknown theme values fail before persistence.
- `GET /api/v1/settings/runtime` returns the persisted theme.
- Explicit light remains fully light even when `prefers-color-scheme: dark`.
- Explicit dark remains fully dark even when `prefers-color-scheme: light`.
- System mode continues to follow `prefers-color-scheme`.
- Home never renders the mixed light-page/dark-surface state reproduced in the supplied screenshot under the covered combinations.
- The theme applies immediately after a successful save without reload.
- A failed save does not falsely switch the application to an unsaved theme.
- The Settings form remains usable at 320 px without horizontal overflow.
- Existing runtime settings, browser, quality, security, container, architecture and release checks remain green.

## Checks

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm deadcode`
- `pnpm deps:check`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm test:browser`
- `pnpm test:coverage`
- `pnpm build`
- `pnpm quality`
- exact-head GitHub Actions, CodeQL and visual evidence where configured

## Risks and rollback

- Risk: applying the theme before first paint could be implemented with a second browser persistence source and drift from SQLite. Mitigation: render the persisted setting into the application shell instead of using local storage.
- Risk: older databases need a safe forward migration. Mitigation: additive migration with default `system`; do not rewrite migration 8.
- Risk: theme-specific CSS can drift between the legacy aliases and the modern semantic tokens. Mitigation: keep modern semantic tokens authoritative and test both explicit modes against opposite OS preferences.
- Rollback: revert the feature commit. Migration 16 is additive and can safely remain with its default `system` value if code is rolled back.

## Delivery

- Branch: `agent/feat-persisted-theme-setting`
- Target: `main`
- Merge, release and deployment remain unauthorized.

## Status

Specification accepted by the user's explicit instruction to continue with the Settings-based theme plan. Implementation and exact-head validation are pending.
