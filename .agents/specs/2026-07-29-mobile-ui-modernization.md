# Basketra mobile UI modernization

## Request
Modernize Basketra's mobile interface so it is visually professional, uses consistent iconography, alignment, spacing, sizing and color, and follows established thumb-friendly mobile interaction patterns. Build the interface from reusable UI components and layouts rather than one-off markup and styles.

## Evidence
- The previous UI used a single compressed stylesheet with limited design tokens and mostly page-specific selectors.
- Primary navigation was text-only and its active state relied on a bordered label.
- Dynamic list, capture, receipt and comparison markup was assembled independently in `app.js`.
- Previous Pixel 7 evidence showed oversized headings, inconsistent control treatment, misaligned preference controls, an unstyled native file input, fixed-element duplication in full-page evidence and insufficient visual hierarchy.
- The application intentionally uses a dependency-free static PWA, so the redesign does not introduce a resident UI framework or runtime dependency.

## Decision
Use a small dependency-free presentation layer in `src/web/ui.js`, a shared app-shell/layout vocabulary in `index.html`, and a tokenized component system in `styles.css`. Use accessible inline SVG icons, shared render functions for dynamic components, a compact sticky header, a thumb-zone bottom navigation, 48-pixel touch targets, progressive disclosure and full-width primary actions.

## Scope
- App shell, header, bottom navigation and home quick actions.
- Shopping-list composer, preferences, AI controls and item rows.
- Receipt upload, capture rows, extraction controls and review cards.
- Comparison plan cards and settings panels.
- Shared tokens, surfaces, buttons, fields, switches, badges, empty states and iconography.
- Static serving and offline caching for the reusable UI module.
- Browser assertions for touch targets, icon navigation, horizontal overflow, layout consistency and complete product flows.
- Pixel 7 viewport PNGs, complete active-view PNGs, GIFs, WebMs, traces and HTML report evidence.

## Risks
- Changing semantic structure can break stable Playwright locators; accessible names and product-contract IDs were preserved.
- Fixed mobile controls can obscure content; safe-area and navigation space are explicitly reserved.
- Decorative icons are hidden from assistive technology while text labels remain authoritative.
- The visual modernization adds no frontend dependency and no resident runtime work.
- Complete screenshots temporarily hide fixed shell elements only inside the test evidence capture; viewport screenshots and videos retain the real shell.

## Acceptance
- All five primary destinations use icon-and-label bottom navigation with a clear active state.
- Shared spacing, typography, radius, border, elevation and color tokens drive the interface.
- Reusable presentation functions render list items, captures, suggestions, receipt review and optimization plans.
- All visible interactive controls are at least 44 CSS pixels high on Pixel 7; the shared touch token is 48 pixels.
- No horizontal page overflow occurs on Pixel 7.
- High-frequency primary actions are reachable in the lower content area and secondary settings are progressively disclosed.
- Existing list, suggestion, receipt, comparison, AI recovery and offline flows remain green.
- Updated PNG, GIF, WebM, trace and report evidence is published in the pull request.

## Validation
- Pull Request Quality run `30443104131` passed Quality, Security, Browser E2E, Container smoke, AMD64 and ARM64 on commit `a3379353cd130f2d6865f0e432f70ef3f368e998`.
- Eight Pixel 7 Chromium flows passed with no retry.
- Browser tests verify five icon navigation destinations, 44-pixel minimum visible targets, shared design tokens and no horizontal overflow.
- Existing shopping-list persistence, stale suggestion cancellation, receipt capture/extraction/correction/import, deterministic comparison, AI recovery and offline focus flows passed.
- `ui.js` is covered by a real integration request and included in the offline application shell cache.
- Permanent media was generated from artifact `8720303759` and published under `docs/evidence/playwright/`.
- The complete artifact is available at `https://github.com/juanjoGonDev/Basketra/actions/runs/30443104131/artifacts/8720303759` until its configured expiry.

## Delivery
Continue on pull request #1. The UI code, regression coverage and permanent visual evidence are committed. Do not merge without explicit authorization.

## Status
Complete for the requested mobile UI modernization scope.
