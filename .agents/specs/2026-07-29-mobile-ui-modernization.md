# Basketra mobile UI modernization

## Request
Modernize Basketra's mobile interface so it is visually professional, uses consistent iconography, alignment, spacing, sizing and color, and follows established thumb-friendly mobile interaction patterns. Build the interface from reusable UI components and layouts rather than one-off markup and styles.

## Evidence
- The current UI uses a single compressed stylesheet with limited design tokens and mostly page-specific selectors.
- Primary navigation is text-only and active state relies on a bordered label.
- Dynamic list, capture, receipt and comparison markup is assembled independently in `app.js`.
- Existing Pixel 7 evidence shows oversized headings, inconsistent control treatment, misaligned preference controls, unstyled native file input, sticky-header overlap in full-page flows and insufficient visual hierarchy.
- The application intentionally uses a dependency-free static PWA, so the redesign must not introduce a resident UI framework or runtime dependency.

## Decision
Introduce a small dependency-free presentation layer in `src/web/ui.js`, a shared app-shell/layout vocabulary in `index.html`, and a tokenized component system in `styles.css`. Use inline accessible SVG icons, shared render functions for dynamic components, a compact sticky header, a thumb-zone bottom navigation, large touch targets, progressive disclosure and full-width primary actions.

## Scope
- App shell, header, bottom navigation and home quick actions.
- Shopping-list composer, preferences, AI controls and item rows.
- Receipt upload, capture rows, extraction controls and review cards.
- Comparison plan cards and settings panels.
- Shared tokens, surfaces, buttons, fields, switches, badges, empty states and iconography.
- Browser assertions for touch targets, icon navigation, horizontal overflow, layout consistency and existing complete flows.

## Risks
- Changing semantic structure can break stable Playwright locators; preserve accessible names and IDs where they represent product contracts.
- Fixed mobile controls can obscure content; reserve safe-area and navigation space explicitly.
- Decorative icons must remain hidden from assistive technology while text labels stay authoritative.
- Visual modernization must not add a frontend dependency or increase idle runtime resource use.

## Acceptance
- All five primary destinations use icon-and-label bottom navigation with a clear active state.
- Shared spacing, typography, radius, border, elevation and color tokens drive the interface.
- Reusable presentation functions render list items, captures, suggestions, receipt review and optimization plans.
- All visible interactive controls are at least 44 CSS pixels high on Pixel 7.
- No horizontal page overflow occurs on Pixel 7.
- High-frequency primary actions are reachable in the lower content area and secondary settings are progressively disclosed.
- Existing list, suggestion, receipt, comparison, AI recovery and offline flows remain green.
- Updated PNG, GIF, WebM, trace and report evidence is published in the pull request.

## Validation
Pending implementation and remote CI.

## Delivery
Continue on pull request #1 and do not merge without explicit authorization.

## Status
In progress.
