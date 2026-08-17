# Native Android-inspired frontend redesign

## Request

Redesign Basketra's existing frontend so every view and reusable UI primitive feels like one professional native Android application: compact, task-oriented, fluid, accessible, visually homogeneous, mobile-first, and easy to understand. This pull request is design-only: preserve business behavior, backend contracts, data semantics, routes, and security boundaries.

The user explicitly permits rebuilding frontend view structure where needed, provided the resulting product remains easier to use and the work stays within frontend design/UX scope. Progress must be demonstrated with real browser screenshots during implementation.

## Evidence

- Basketra is a dependency-free static PWA served by the existing Node.js process. `package.json` uses pnpm 10.15.0, Node 22.23.1, Playwright browser tests, and `pnpm quality` as the repository quality gate.
- `src/web/index.html` owns the static application shell and primary views: Home, Lists, Tickets, Plans, and Settings.
- `src/web/styles.css` owns the original shared tokens and most component/layout rules. `src/web/modern.css` currently applies a second incremental visual layer. `src/web/operations.css` adds a third visual layer for Settings/operations. The current split produces duplicated visual rules for progress, surfaces, radii, and component presentation.
- Existing UI behavior and shared interaction primitives already live in `src/web/ui.js`, `lists.js`, `receipts.js`, `app.js`, and `operations.js`. The repository intentionally has no React, component framework, Storybook, or external icon package.
- Existing Playwright coverage captures Pixel 7 UI flows and dedicated responsive Settings screenshots at 320, 360, 390, 430, and 768 CSS pixels, plus desktop operations evidence.
- Current baseline evidence shows the same product using noticeably different density and grouping conventions across Home, Lists, Tickets, and Settings. Settings is especially narrow on desktop, while Tickets is visually dense and card-heavy on mobile.
- The canonical frontend guide requires mobile-first design, WCAG 2.2 AA, persistent zoom, semantic native controls, predictable focus, 44px-class touch targets where reasonable, reduced motion, reusable tokens/components, and no decorative card proliferation.
- Material Design 3 is used as a design reference only for Android-native visual language and adaptive scaffolding. No Material dependency, Android framework, React stack, or parallel design system will be introduced.

## Context detected

### Stack

- Dependency-free HTML/CSS/JavaScript PWA.
- Node.js 22 runtime, pnpm 10.15.0.
- Existing SVG icon hydration in `ui.js`.
- Native HTML dialogs, details, form controls, buttons, navigation, and landmarks.
- Existing light/dark color scheme using CSS custom properties.
- Existing Playwright browser suite and PR visual-evidence workflow.
- No Storybook or local component catalog.

### Existing reusable primitives

- Buttons and icon buttons.
- Bottom navigation.
- App/header region and connection status.
- Surfaces, section headings, status chips/pills, count badges.
- Fields, selects, textareas, switches, progressive details.
- Dialog/sheet patterns.
- Capture actions and receipt progress.
- Swipe rows and accessible equivalent actions.
- Toast/status feedback.
- Operations metrics, logs, diagnostic states, backup/restore controls.

## User objective

The primary user should be able to open Basketra on a phone and immediately understand where they are, what the main action is, and what changed after interacting, without visually parsing several competing cards or styles. The same information architecture must scale cleanly to tablet and desktop without becoming a stretched phone column.

## Scope

### In scope

- Redesign all five primary views and the shared shell.
- Normalize all reusable visual primitives into one coherent Android-inspired system.
- Rework view hierarchy and static HTML grouping where it improves task clarity.
- Rework generated frontend markup classes when necessary, without changing domain behavior.
- Adaptive compact/medium/expanded layouts using the same information architecture.
- Light and dark schemes using the existing green product identity as the seed/accent.
- Motion and interaction states that feel responsive while honoring reduced motion.
- Accessible focus, keyboard, touch sizing, reflow, zoom, labels, semantic regions, and destructive-action separation.
- Browser screenshots for major milestones and stable final states.
- Browser/E2E regression coverage for layout, focus, responsive behavior, and visual-contract invariants.

### Out of scope

- Backend/API/database/authentication changes.
- New business behavior or data fields.
- New runtime dependencies or component frameworks.
- New icon libraries unless separately approved.
- Deployment/release infrastructure changes.
- Changes to OCR/AI scheduling or extraction semantics.
- Changing private-network security assumptions.

## Decision

1. Treat Basketra as one adaptive Material-3-inspired product, not a collection of independently styled pages.
2. Preserve the dependency-free runtime. Extract principles from Android/Material patterns; do not import Material Web or another UI framework.
3. Keep the existing green identity, but remap it into semantic surface/on-surface/primary/container/outline/status tokens so light and dark modes use the same vocabulary.
4. Use one compact top app bar language across screens. Brand identity should be quiet; the current task/view title and context take priority.
5. Keep five-destination bottom navigation on compact screens. Use a navigation rail or equivalent persistent side navigation on expanded layouts so desktop gains useful content width without changing destinations.
6. Replace general-purpose card stacking with proximity, dividers, tonal containers, and list rows. Cards/surfaces remain only where a real entity or grouped task benefits from containment.
7. Use one shared component language for filled, tonal, outlined, text, danger, and icon actions. One dominant primary action per region.
8. Use bottom-sheet-style native dialogs on compact screens and centered dialogs/panes on larger screens while retaining native `<dialog>` semantics and current focus behavior.
9. Keep touch targets at least WCAG AA-compliant and generally 44-48 CSS px for primary mobile controls.
10. Keep current gesture behavior, but ensure visible button alternatives remain first-class and visually consistent.
11. Preserve zoom and 320 CSS px reflow. Do not introduce fixed heights around variable content.
12. Use short state transitions only for navigation, sheet entrance, pressed/selected states, progress, and content reordering; disable nonessential motion under `prefers-reduced-motion`.
13. Keep all existing IDs and stable accessible names unless a test-backed UX change requires adjusting copy. Do not change endpoint paths or request payloads.
14. Consolidate visual ownership so the three CSS layers no longer redefine the same primitive inconsistently. `styles.css` remains structural/base CSS; `modern.css` becomes the canonical semantic theme/component visual layer; `operations.css` contains only operations-specific layout/content rules and consumes shared tokens/primitives.

## Flow

### Home

- Entry: app launch or Home navigation.
- Goal: choose the next task quickly.
- Primary action: open Lists.
- Secondary actions: capture a ticket or compare plans.
- Design: compact welcome/task header, three clear task rows/actions, private-network status presented as supporting information rather than a hero decoration.

### Lists

- Overview: app bar + primary create action + list rows/cards with compact metadata and clear empty state.
- Detail: back + list title + realtime state + overflow management, then primary add-product action, pending items, completed items, optional AI action.
- Preserve swipe interactions and all pointer/keyboard alternatives.

### Tickets

- Present one continuous workflow instead of two visually separate large cards.
- Capture actions first, then page queue/status, then verification/extraction, then review and confirmation.
- Each capture behaves like a native task row with thumbnail, page status, progress, and contextual actions.
- Keep errors, cancel, retry, and preserved-data messages local to the relevant capture/workflow state.

### Plans

- Present one concise explanation and primary run action.
- Plans use a consistent comparison component with strong price/strategy hierarchy and restrained supporting metadata.

### Settings

- Separate Runtime, AI diagnostics, Logs, and Backup/Restore into clear settings groups.
- Compact screens use one vertical settings stack.
- Expanded screens use an adaptive supporting-pane/grid layout so runtime/diagnostic data and operational tools use available width without stretching text.
- Destructive restore remains visually isolated from safe backup/import actions.

## Mobile design

- Compact app bar with safe-area padding.
- One-column task flow and 16px-class page gutter.
- Bottom navigation remains visible without covering focused controls or error text.
- Main actions are reachable and use 48px-class control height where practical.
- Sheets use near-full-width bottom placement with clear title, drag-independent close control, sticky action area only when it does not obscure fields.
- Typography uses a compact Android-like hierarchy: title for screen/task, body for instruction, label for metadata; no oversized marketing hero typography.
- Inputs and controls remain usable with the virtual keyboard and at 200% zoom.

## Desktop adaptation

- Replace the narrow centered phone column with an adaptive scaffold.
- Persistent side navigation on expanded width.
- Main content uses bounded readable columns and, where beneficial, two-pane supporting layouts.
- Lists and Tickets remain task-sequential rather than becoming unrelated dashboard grids.
- Settings may use two columns because its sections are independent operational groups.
- No desktop-only actions or domain behavior.

## Visual system

### Tokens

Canonical semantic tokens will cover:

- `--color-bg`, `--color-surface`, `--color-surface-container`, `--color-surface-container-high`.
- `--color-on-surface`, `--color-on-surface-variant`, `--color-outline`, `--color-outline-variant`.
- `--color-primary`, `--color-on-primary`, `--color-primary-container`, `--color-on-primary-container`.
- Success/warning/error containers and on-colors.
- Focus ring.
- Type scale/weight/line-height.
- 4/8-based spacing rhythm.
- Small/medium/large/full shape roles.
- Motion durations/easing.
- Navigation/app-bar dimensions and content max widths.

### Shared components

- Top app bar.
- Navigation bar/rail.
- Filled, tonal, outlined, text, danger, and icon buttons.
- List/settings rows.
- Chips/status indicators.
- Text fields/selects/textareas.
- Switch rows.
- Section headers/dividers.
- Dialog/bottom sheet.
- Snackbar/toast.
- Progress indicator.
- Empty/error state.
- Capture/task row.
- Plan/comparison row.

No speculative JavaScript component framework will be created. Reuse is achieved through semantic HTML classes, existing rendering helpers, and central CSS tokens.

## Accessibility

- Maintain semantic native elements before ARIA.
- Preserve skip link, heading order, landmarks, dialog semantics, and accessible labels.
- Keyboard access for all actions, including swipe alternatives.
- Strong `:focus-visible` state on every interactive primitive.
- No focus hidden beneath app bar/navigation.
- Minimum WCAG 2.2 AA contrast; important state indicators use color plus text/icon/shape.
- Responsive target sizing; primary mobile controls generally >=44x44 CSS px.
- Zoom remains enabled; 200% zoom and 320 CSS px reflow are explicit acceptance cases.
- `prefers-reduced-motion` removes nonessential transforms/transitions.
- Loading, error, retry, offline, disabled, selected, and destructive states remain understandable without color alone.

## Tests

### Browser/E2E

- Existing happy-path behavior remains unchanged across Home, Lists, Tickets, Plans, Settings.
- Pixel 7 compact flow screenshots for all five primary destinations.
- Responsive screenshot/check matrix: 320, 390, 768, 1024, and expanded desktop.
- Light/dark Settings and at least one primary task screen.
- No horizontal page overflow.
- Bottom navigation does not obscure focused content.
- Expanded navigation scaffold appears only at the intended content breakpoint and preserves navigation semantics.
- Dialogs/sheets remain keyboard operable and return focus.
- Destructive actions remain separated and clearly labeled.
- Reduced-motion contract remains present.
- Browser zoom is not disabled.

### Existing quality

- `pnpm quality` remains canonical.
- Existing browser suite remains green.
- Existing container smoke/build/security/CodeQL workflows remain unchanged and green.
- PR visual-evidence workflow provides final browser screenshots/videos.

## Planned files

Expected frontend-only implementation files:

- `.agents/specs/2026-08-17-native-android-ui-redesign.md`
- `src/web/index.html`
- `src/web/styles.css`
- `src/web/modern.css`
- `src/web/operations.css`
- `src/web/operations.js` only if semantic grouping/classes are required for the Settings redesign
- `src/web/ui.js` only if shared presentation helpers/icons need markup adjustments without behavior changes
- `src/web/lists.js` only if generated markup needs semantic presentation classes
- `src/web/receipts.js` only if generated capture/review markup needs semantic presentation classes
- `tests/browser/basketra.spec.mjs`
- `tests/browser/mobile-settings-receipts.spec.mjs`
- `tests/browser/operations.spec.mjs`
- optionally one focused browser design-contract spec if that is clearer than expanding unrelated tests

No backend, database, API, Docker, release, or deployment files are planned.

## Risks

- A global visual refactor can accidentally hide controls, break long-content reflow, or create mobile keyboard/focus obstruction. Mitigation: incremental slices with browser screenshots and existing functional tests after each slice.
- CSS ownership is currently split across three files. Consolidation must avoid specificity wars and must not silently change feature behavior.
- Desktop navigation changes can become a second information architecture. Mitigation: same destinations/order, adaptive scaffold only.
- Native-Android resemblance can become decorative imitation. Mitigation: prioritize task hierarchy, state consistency, accessibility, and adaptive layout over literal copying.
- Current tests assert some copy and layout-level selectors. Preserve stable IDs/accessibility contracts and change test expectations only when the UX requirement intentionally changes.

## Rollback

All changes will be delivered as atomic Conventional Commits. Each slice is independently revertible: shared system, shell/navigation, Lists, Tickets, Plans, Settings, and final regression/visual coverage.

## Acceptance

- All primary screens look like one coherent Android-native-inspired product in light and dark modes.
- No screen uses an unrelated radius, button style, card language, field treatment, status pattern, or typography hierarchy without a documented semantic reason.
- Home is task-oriented rather than marketing/hero-oriented.
- Lists uses clear overview/detail hierarchy with compact mobile rows and accessible actions.
- Tickets reads as one continuous workflow; capture/page progress is understandable at a glance and not buried in nested cards.
- Plans are visually comparable and prioritize actionable cost/strategy information.
- Settings uses mobile space efficiently and expands into a useful desktop layout instead of a narrow column.
- Mobile bottom navigation is consistent and touch-friendly; expanded navigation uses the same destinations.
- Native dialogs remain accessible and adapt visually to bottom sheets on compact screens.
- 320 CSS px, Pixel-class mobile width, 768, 1024, expanded desktop, 200% zoom, and both orientations where relevant do not lose functionality or create global horizontal scrolling.
- Keyboard focus is visible, ordered, and unobscured.
- Reduced motion is respected.
- Existing business behavior and API contracts are unchanged.
- No new runtime dependency is added.
- Real screenshots are reviewed during implementation and attached to the PR visual evidence.
- Relevant tests, build, quality, browser E2E, security, containers, and CI pass.

## Checks

Before final delivery:

1. Inspect diff for frontend-only scope.
2. Run/observe `pnpm quality`.
3. Run/observe Playwright browser E2E and screenshot evidence.
4. Verify mobile 320/390, tablet 768, desktop 1024+ and 200% zoom.
5. Verify keyboard focus and dialogs manually through browser evidence/tests where supported.
6. Verify light/dark and reduced motion.
7. Verify no secrets, new dependencies, backend contracts, or unrelated behavior changed.
8. Inspect PR CI until required checks are green or report the exact blocker.

## Delivery

Branch: `agent/ui-android-native-redesign`.

Commit strategy after specification acceptance:

1. `refactor(ui): unify semantic design tokens`
2. `feat(ui): add adaptive Android app scaffold`
3. `refactor(lists): simplify native list experience`
4. `refactor(receipts): streamline capture workflow`
5. `refactor(plans): clarify comparison layout`
6. `refactor(settings): organize adaptive operations UI`
7. `test(ui): cover adaptive visual contracts`

Pull request will target `main`, remain design-only, and will not be merged without explicit approval.

## Status

Accepted by the user on 2026-08-17. The user has granted standing approval to proceed with reversible design-only implementation work on this PR without asking again. Implementation and screenshot review are in progress.