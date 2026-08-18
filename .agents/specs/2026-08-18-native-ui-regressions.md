# Native UI regression fixes

## Request

Fix the regressions reported during real-browser review of PR #32:

- Settings AI diagnostics can generate an extreme request storm against `/api/v1/settings/ai-provider`; the UI must never poll or hammer this endpoint.
- AI diagnostic status text needs proper internal spacing and must read like a native Android status surface rather than raw web text against an edge.
- Receipt confirmation currently gives no visible feedback when confirmation fails while the sticky action is in view.
- Receipt review lines expose destructive swipe colors while closed, use raw `needs-review` copy, and feel visually disconnected from the rest of the Android-inspired system on mobile and desktop.
- Continue moving the touched workflow toward a cohesive native-Android interaction model without adding a UI framework or changing business contracts.

The user granted standing approval for reversible implementation work on this PR. Merge, release and deployment remain out of scope.

## Evidence

- `src/web/operations.js` loads AI settings from `GET /api/v1/settings/ai-provider` during operational refresh and again after a connection restoration; there is currently no explicit request coalescing or freshness window.
- The canonical PR source does not intentionally auto-run the expensive provider probe; `POST /api/v1/settings/ai-provider/test` is wired to the explicit verification button.
- `src/web/receipts.js` writes confirmation failures only to `#receipt-state`, which can be far above the sticky confirmation action and therefore appear as if the button did nothing.
- `src/web/ui.js` renders receipt rows as `fieldset` elements inside a swipe rail and exposes the internal validation value `needs-review` directly to the user.
- Base swipe rails remain rendered beneath closed rows. Rounded receipt containers can reveal the destructive rail color at corners/edges even before the user opens the actions.
- The user supplied desktop and Pixel-class screenshots showing all four issues in a real browser.

## Decision

1. Keep the existing manual-only expensive AI probe. Do not add background provider tests.
2. Coalesce operational refreshes and AI-settings reads in the client, and reuse a short-lived settings snapshot so repeated callers cannot generate a request storm.
3. Add browser regression coverage that observes the actual network and fails if AI-settings requests grow while the page is idle.
4. Give `#ai-test-state` a dedicated Material-style status container with spacing, state colors and `:empty` suppression.
5. Add confirmation feedback adjacent to the sticky confirm action. Validation/confirmation failures must be visible there and also remain available through the existing global receipt status.
6. Redesign receipt lines as semantic article-like review surfaces with a compact header, localized validation state, short visual field labels and existing accessible input names.
7. Hide destructive swipe rails while rows are closed; reveal them only while dragging, explicitly open or committing a destructive swipe.
8. Preserve all existing receipt APIs, OCR behavior, evidence, undo, swipe alternatives and deterministic confirmation rules.
9. Refresh the PWA shell cache so installed clients cannot retain the broken frontend assets.

## Scope

In scope:

- `src/web/operations.js`
- `src/web/operations.css`
- `src/web/receipts.js`
- `src/web/ui.js`
- `src/web/index.html`
- `src/web/modern.css`
- `src/web/sw.js`
- affected browser/unit tests

Out of scope:

- database schema or migrations
- receipt domain calculations
- OCR/AI provider contracts
- backend deployment/runtime architecture
- new dependencies
- merge/release/deploy

## Risks

- Request deduplication can accidentally serve stale settings indefinitely if the freshness policy is unbounded.
- Swipe visibility changes can break pointer-drag reveal if the rail is hidden during an active gesture.
- Receipt markup changes can break existing accessible names or browser tests if labels are changed without preserving `aria-label` contracts.
- Sticky feedback can cover content on compact screens if it is implemented as an additional independent fixed element.

Mitigations: bounded freshness, explicit active-swipe selectors, stable IDs/data attributes/accessible names, one shared sticky confirmation container, and Playwright coverage at 320/390/desktop.

## Tests

TDD-light regressions:

- while Settings is idle, `GET /api/v1/settings/ai-provider` remains bounded and `POST /api/v1/settings/ai-provider/test` stays at zero until the user presses the button;
- a manual provider verification still emits exactly one POST;
- a closed receipt row does not expose its destructive rail, and opening actions reveals it;
- receipt validation state is localized instead of exposing `needs-review`;
- confirming an invalid receipt line shows an error adjacent to the confirm action and preserves the draft;
- existing receipt import, swipe edit/delete/undo, OCR retry, 320px reflow and no-horizontal-overflow flows remain green;
- service-worker shell cache version regression is updated.

## Acceptance

- No AI-settings request storm is reproducible from an idle Settings view or connection refresh.
- The expensive AI provider test is manual and single-flight.
- AI diagnostic feedback has comfortable padding and semantic state presentation.
- Invalid receipt confirmation visibly explains the error next to the action the user pressed.
- Receipt rows look coherent with the Android-inspired visual system on mobile and desktop; no red destructive rail leaks while closed.
- Internal validation codes are not shown directly to users.
- Existing business/API behavior remains unchanged.
- No new runtime dependency is added.
- `pnpm quality`, Browser E2E, Security, container smoke, amd64/arm64 and CodeQL are green on the final head.
- New real screenshots are reviewed before delivery.

## Rollback

Revert the focused commits for request coalescing, receipt feedback/row presentation and PWA cache refresh. No data rollback or migration is required.

## Delivery

Continue on `agent/ui-android-native-redesign` / PR #32 using atomic Conventional Commits. Do not merge without explicit merge authorization.

## Status

Accepted from the user's 2026-08-18 browser review. Regression tests and fixes are in progress.
