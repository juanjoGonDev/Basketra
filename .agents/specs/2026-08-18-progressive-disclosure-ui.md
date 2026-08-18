# Progressive disclosure UI redesign

## Request

Reorganize Basketra so primary app screens stop exposing all content at once. Reduce unnecessary vertical scrolling and make the PWA feel closer to a native Android application by using progressive disclosure: internal tabs for sibling task areas, accordions for secondary/technical detail, compact summaries, contextual editing surfaces, and sticky primary actions where appropriate.

The user explicitly accepted the implementation plan and requested that all proposed changes be implemented in the existing UI PR.

## Evidence

- The current Tickets view exposes capture, extraction controls, manual review, every editable receipt line, totals, validation, and confirmation in one vertical document.
- Receipt lines render as full fieldsets with four editable inputs each, causing long pages on both mobile and desktop.
- Settings injects Runtime, AI diagnostics, Logs, and Backup/Restore cards into one long operations stack.
- Plans exposes all generated strategies simultaneously.
- Completed shopping-list items are always expanded when present.
- The project uses plain HTML/CSS/JS, native `dialog`/`details`, semantic controls, Playwright browser tests, and no UI framework dependency.
- The project UI/UX guide requires mobile-first, WCAG 2.2 AA as the accessibility target, progressive disclosure for advanced/contextual options, visible primary actions, preserved browser zoom, and no dependency introduction when the existing stack is sufficient.

## Decision

1. Keep global navigation unchanged: bottom navigation on compact screens and navigation rail on expanded screens.
2. Add one reusable, dependency-free accessible tab interaction for sibling content inside a destination. Tabs use native buttons with `role=tab`, roving `tabindex`, `aria-selected`, `aria-controls`, Arrow/Home/End keyboard support, and hidden tab panels.
3. Tickets becomes four task tabs:
   - Capturas: add/reorder/remove source files.
   - Progreso: AI option, extraction action, per-page processing status and retry/cancel controls.
   - Revisión: retailer, total, validation and compact receipt-line list.
   - Importar: final summary, outstanding-state guidance, inline confirmation feedback and the single primary import action.
4. Receipt lines become compact list rows. Editing happens in a native `dialog` that behaves as a bottom sheet on compact screens and centered contextual editor on expanded screens. The data model remains authoritative in `receipts.js`; editing the dialog updates the same `state.items` model and invalidates stale line validation.
5. Progress automatically selects the Progreso tab when processing starts. A completed extraction selects Revisión. Successful validation may expose Importar, while validation/confirmation errors move focus back to the relevant review control instead of hiding the problem.
6. Settings becomes five internal tabs: General, IA, Diagnóstico, Datos, Avanzado. Existing operations controls and IDs are preserved and moved into the appropriate panels. Provider request/auth/network details use `details` disclosure and Logs remain bounded inside their own scroll region.
7. Plans uses sibling tabs after generation: Mejor opción, Comparativa, Detalle. The recommendation is derived from the already returned plan order/data; no pricing/business calculation is duplicated in the client.
8. Lists keeps pending products visible and puts completed products in a collapsed native `details` section by default.
9. Home remains intentionally short: one primary task plus compact quick actions. No extra dashboard content is added.
10. Do not attempt a literal zero-scroll rule. Scroll remains available for user-generated content; the goal is to keep primary controls and the current task visible without forcing the user through unrelated sections.

## Scope

### In scope

- `src/web/index.html`
- `src/web/app.js`
- `src/web/receipts.js`
- `src/web/ui.js`
- `src/web/lists.js`
- `src/web/modern.css`
- `src/web/operations.js`
- `src/web/operations.css`
- affected browser tests and PWA shell tests only if asset contracts change
- PR description and visual evidence

### Out of scope

- API contracts
- server receipt validation rules
- database schema or migrations
- OCR/AI scheduling architecture
- authentication
- deployment/release behavior
- new frontend frameworks or component libraries

## Risks

- Hiding a control in the wrong tab could make an error hard to discover. Error paths must select/focus the panel containing the actionable fix.
- Replacing inline receipt inputs with a dialog changes DOM assumptions in existing tests and `readReceiptItems`; the canonical client model must be updated before render and tests must assert behavior rather than obsolete layout details.
- Tabs must not become a second global navigation architecture. They are limited to sibling areas inside one existing destination.
- Dialog focus must return to the row that opened it when possible.
- Sticky actions must not obscure focused controls or error messages at 320 CSS px / zoomed layouts.

## Acceptance

- At 390x844, opening Tickets initially shows only Capturas content; unrelated review/import content is not displayed.
- Tickets exposes four keyboard-operable tabs with correct ARIA selection semantics.
- Starting extraction selects Progreso; completed extraction exposes/selects Revisión.
- Receipt review renders compact rows rather than four always-visible inputs per line.
- Editing a receipt line opens an accessible dialog/sheet, preserves data on error, saves back to the canonical `state.items`, and returns focus predictably.
- Import confirmation remains blocked client-side for an incomplete product line and no `/api/v1/receipts/confirm` request is issued.
- Settings exposes five internal tabs and only one settings panel is visible at a time.
- AI technical transport details are collapsed by default but keyboard accessible.
- Logs and backup/restore retain all existing actions and semantics.
- Completed shopping-list products are collapsed by default and can be expanded with native keyboard/touch interaction.
- Plans does not show all plan detail simultaneously after generation; a selected strategy/comparison/detail view is explicit.
- No global horizontal overflow at 320, 390, 768, 1024, and expanded desktop viewports.
- Browser zoom remains enabled; touch targets stay at least 44 CSS px where practical; visible focus and reduced-motion contracts remain intact.
- No new runtime dependency is added.

## Tests

- Extend Playwright design tests for tab semantics, keyboard navigation, one-visible-panel behavior, compact receipt lines, receipt edit sheet, collapsed completed lists, settings disclosure, and responsive screenshots.
- Update receipt regression tests to assert the new compact row/editor behavior while retaining confirmation-error and request-count coverage.
- Preserve existing operational tests for AI probe, logs, backups, heartbeat, OCR concurrency/recovery and offline shell.
- Run repository `quality` workflow, Browser E2E, security, container smoke, linux/amd64, linux/arm64, CodeQL and visual evidence through GitHub Actions.

## Rollback

All changes are frontend-only and reversible by reverting this task's commits. No data migration or API rollback is required.

## Delivery

- Branch: `agent/ui-android-native-redesign`
- PR: #32
- Commit strategy: atomic Conventional Commits per cohesive interaction/style/test change.
- Merge remains explicitly out of scope until separately authorized.

## Status

Accepted; implementation in progress.
