# Global Icon Language

## Request

Modernize Basketra's existing UI with meaningful icons in the same restrained visual language as the current Android-inspired redesign. The runtime/version tiles should follow the visual hierarchy demonstrated in the accepted Stitch reference, and high-signal buttons across all primary destinations should use icons where they improve scanning without replacing text labels.

## Evidence

- The shared `ui.js` module already owns Basketra's inline SVG icon registry, `icon()` renderer and `hydrateIcons()` behavior; this is the canonical icon source and no package is required.
- Home, navigation, list gestures and ticket capture already consume that canonical system, but Settings operational metrics render as text-only tiles and several operational actions remain text-only.
- Exact-head visual evidence for the current PR shows the Settings `Versión`, `Activo`, `Inicio` and `Memoria` tiles without icons, despite the accepted Stitch direction using a leading icon to improve recognition.
- Current Settings buttons such as provider verification, log refresh/copy, backup creation/import/restore are high-signal operational actions but do not expose icons.
- The Plans primary action `Generar ejemplo verificable` is also text-only while adjacent destinations already pair their principal actions with icons.
- Text labels remain necessary for accessibility and clarity; this task does not convert ordinary labeled actions into unexplained icon-only controls.

## Decision

- Keep `ui.js` as the single source of truth for all interface SVGs. Extend it only with the small set of missing semantic icons required by this task.
- Add icon + label/value composition to runtime metric tiles instead of decorative standalone imagery.
- Add icons to high-signal operational buttons and remaining primary destination CTAs, while preserving their existing visible text and accessible names.
- Use current semantic colors, spacing, touch targets, focus states and light/dark tokens; do not introduce an icon dependency or a parallel icon component.
- Keep icon-only buttons limited to compact utility actions that already have an explicit accessible name.

## Acceptance

1. Settings runtime tiles for version, uptime, start time and memory display distinct canonical icons without losing any label or value.
2. Settings provider verification, log refresh, log copy, backup creation, backup download, backup import and restore actions display meaningful canonical icons while retaining their text labels.
3. The Plans primary generation action displays a canonical icon and retains its text label.
4. Existing Home, Lists, Tickets, Plans, Settings navigation and receipt-review icon behavior remains intact.
5. Icons inherit semantic foreground colors, remain legible in light/dark schemes and do not create horizontal overflow at 320 px.
6. Browser E2E verifies visible SVG icons inside the targeted controls and metric tiles at compact width, plus desktop Settings layout stability.
7. Canonical quality, browser changed-code coverage, security, container checks, CodeQL and visual evidence pass on the exact delivery head.

## Checks

Pending implementation and exact-head CI.

## Delivery

PR #32 (`agent/ui-android-native-redesign`). Use atomic Conventional Commits. No merge, release or deployment.

## Status

In progress.
