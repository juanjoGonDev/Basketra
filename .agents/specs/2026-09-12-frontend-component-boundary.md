# Frontend component boundary and no-build runtime evaluation

## Status

Proposed. No framework migration or dependency change is authorized by this document.

## Problem

Receipt source editing exposed a one-off dialog with local markup and CSS. It bypasses the existing shared field, dialog, action and spacing contracts, causing inconsistent sizing, overflow and button alignment. This is a product defect, not a styling exception.

## Constraints

- The installed app must remain usable offline as a mobile PWA.
- The production Raspberry Pi process must use minimal resident RAM and remain a single Node process.
- No CDN may be required at runtime; all browser modules must be served from the application and precached by the existing service worker.
- The migration must not require a build pipeline, a watcher, a second server, or new `package.json` commands.
- Existing dependency-free runtime remains the default. A framework is acceptable only when it measurably improves the enforced component boundary without violating the above.
- A component gallery must be a normal application route/module, not Storybook. Storybook requires its own development/build workflow and is rejected by the no-new-command constraint.

## Component contract

Every interactive overlay must be composed from registered primitives rather than local HTML/CSS:

- `app-dialog`: focus handling, width, responsive layout, header/footer, close action and overflow.
- `app-field`: label, control, help/error and spacing.
- `app-button`: primary/secondary/danger/icon variants, touch target and busy state.
- `app-stack` and `app-inline`: canonical vertical/horizontal gaps and wrapping.
- `app-select`: option presentation and empty/new-value affordance.

Feature modules may provide only content and data. They may not define dialog chrome, field layout, button geometry or copied token values. A lint/test rule must reject feature-local dialog selectors and direct `document.createElement('dialog')` outside the component module.

## Candidate runtimes

### A. Native Custom Elements + ES modules — recommended

Use browser-native custom elements and templates; no framework runtime. Components are normal local ESM modules, served and precached like the current modules. This is the smallest RAM/network option and genuinely enforces a reusable element boundary. The gallery is `/components`, generated from a static registry and exercised by Playwright.

Trade-off: explicit DOM rendering and state wiring remain handwritten, but that is compatible with the current dependency-free architecture.

### B. Lit, locally vendored ESM — conditional alternative

Lit supplies declarative Web Components while retaining native custom-element boundaries. It must be vendored as a pinned local ESM artifact; bare package imports need either rewritten relative imports or an import map. No CDN and no runtime fetch are allowed. Use only after measuring its transferred and retained footprint against option A.

Trade-off: more ergonomic rendering, but introduces vendored third-party code and module-resolution maintenance.

### C. Preact + HTM, locally vendored ESM — conditional alternative

Preact can run without JSX/build tooling and HTM provides template literals. It gives conventional functional components and a testable tree, but adds a virtual-DOM runtime and a migration cost. It is suitable only if the team requires React-like composition strongly enough to justify more RAM than native components.

### Rejected for this project

- React, Angular, standard Vue and Svelte: their normal, maintainable component workflows require compilation/build tooling or carry a much larger runtime compiler bundle without it.
- petite-vue: it is lightweight and no-build, but its official Vue documentation says it is no longer actively maintained; it is unsuitable as a new foundation.
- Storybook: it explicitly requires separate preview/build commands and generated static output.

## Acceptance checklist

- [ ] Replace the receipt source editor with shared primitives before adding another receipt overlay.
- [ ] Add the `/components` offline gallery with every component state: default, hover/focus, disabled, busy, error and narrow mobile.
- [ ] Add browser visual/interaction tests for every gallery entry.
- [ ] Add enforcement tests prohibiting feature-local dialog chrome and direct native dialog construction.
- [ ] Measure cold-start memory, PWA precache bytes and offline launch before/after the selected option.
- [ ] Keep existing production commands unchanged and pass `pnpm quality`.
- [ ] Decide runtime only after the measurement; record the evidence and exact pinned artifact if option B or C is selected.

## Sources

- Lit requires resolving bare module specifiers for browsers, which normally motivates build tooling: https://lit.dev/docs/tools/requirements/
- Preact documents a no-build browser route: https://preactjs.com/guide/v10/getting-started/
- Vue documents that petite-vue is no longer actively maintained: https://vuejs.org/guide/extras/ways-of-using-vue
- Storybook documents separate preview/build commands and static output: https://storybook.js.org/docs/writing-docs/build-documentation
