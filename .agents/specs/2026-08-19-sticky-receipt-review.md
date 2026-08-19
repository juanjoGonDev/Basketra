# Sticky Receipt Review Context

## Request

Keep receipt evidence and the calculated total continuously available while users review and correct ticket lines. Desktop should behave like a two-column review workspace with sticky evidence and sticky summary. Mobile should preserve editing space without covering focused controls, the bottom navigation, or the software keyboard.

Latest mobile feedback: the sticky review chrome is still too tall. Replace the stacked compact image/title/expand row plus total/status/full-width confirmation block with one dense sticky row: an image icon that opens the existing preview, the calculated price by itself, and a small validation/finalization action in the same row. Do not show the compact image title/filename, the `Ampliar` text button, or the `Total calculado` label on mobile.

## Evidence

- The current compact implementation consumes two sticky rows on a 390px mobile viewport: a 4.25rem evidence strip and a 7.25rem summary block. This materially reduces the editor viewport.
- The full selected receipt image already remains available in normal document flow, so the mobile sticky affordance does not need a second thumbnail/title representation.
- `#capture-preview-dialog` is already the canonical enlarged-image viewer.
- `.review-total` is the canonical calculated-total node and `#confirm-receipt` is the canonical final action; both must remain single-source.
- `src/web/ui.js` is the single icon owner. The existing `image` and `check` SVGs are sufficient; no new icon dependency or asset family is needed.
- The current `confirmReceipt()` flow validates the receipt before import and stops when totals are invalid, so a compact final action can reuse the same behavior without duplicating validation logic.
- Existing mobile focus recovery uses the sticky summary bounds plus `VisualViewport`, so reducing the sticky stack can simplify its reserved top space rather than adding another overlay.

## Decision

- Desktop behavior remains unchanged: sticky evidence rail on the left and sticky total/status/final action summary on the editor side.
- Mobile uses one sticky toolbar only. It contains, in order: an icon-only image preview button, the calculated amount, and the canonical final action rendered as a compact button.
- The mobile preview control uses the canonical `image` SVG, keeps a minimum touch target, exposes an accessible name that includes the selected capture, and opens the existing preview dialog. It has no visible `Ampliar` text and no thumbnail/title/filename in the sticky toolbar.
- The mobile calculated amount reuses `.review-total` and hides only its textual `Total calculado` label; the formatted amount remains visible and canonical.
- The canonical `#confirm-receipt` button remains the final control. On compact screens its visible label is `Validar`; on expanded screens it remains `Confirmar e importar`. No second handler or parallel action is introduced.
- The sticky validation pill remains available on desktop but is hidden from the compact toolbar to save vertical/horizontal space. Validation/import failures continue to surface through the existing receipt state and editable review UI.
- Mobile sticky height is reduced to one touch-safe row and all focus scroll margins/visual-viewport recovery are recalculated from that single row.
- Service-worker shell revision must advance because installed PWA clients cache the affected HTML/CSS/JS.
- No OCR, AI, backend, database, API, authentication, persistence, dependency, queue or migration contract changes are part of this follow-up.

## Acceptance

1. At 390px and narrower, the sticky receipt review context is a single horizontal row rather than stacked evidence + summary blocks.
2. The mobile row shows no compact `Imagen N de N`, filename, thumbnail, `Ampliar` text, `Total calculado` text, or validation-status pill.
3. The first control is an icon-only image button with the canonical SVG, a touch-safe hit area and an accessible capture-specific name; activating it opens the existing preview dialog.
4. The calculated amount is directly visible in the middle of the row and still comes from the canonical `.review-total` node.
5. The canonical `#confirm-receipt` action is compact and on the same row, shows `Validar` on mobile, keeps its icon, and still runs the existing validate-then-import flow.
6. Desktop retains the current sticky evidence rail, visible `Total calculado`, validation pill and `Confirmar e importar` label.
7. Switching the selected capture updates the preview button's accessible identity and preserves edited receipt rows.
8. Mobile sticky geometry does not overlap the bottom navigation and focused inputs remain visible above the sticky row and software keyboard.
9. Browser E2E covers compact-row contents, one-row geometry, preview activation, capture switching, compact final action, desktop regression and focus visibility.
10. Automatic OCR, optional AI correction, two-slot pool recovery, cancellation, retailer autofill, offline shell and service-worker safety remain unchanged.
11. Canonical quality, browser diff coverage, security, container smoke/builds, CodeQL and exact-head visual evidence pass before delivery.

## Checks

Previous validated icon head `a246bc805d5151c75b55ca1ff4dff8ec1a99b39a` passed all canonical gates with 43/43 Chromium tests and 100% changed-code coverage. This compact-density follow-up requires a new failing acceptance test first, then exact-head revalidation.

## Delivery

Continue on PR #32 (`agent/ui-android-native-redesign`) with atomic Conventional Commits. No merge, release, deployment, migration, dependency or API-contract operation is authorized by this task.

## Status

Reopened for compact mobile-density feedback. Specification updated; failing acceptance coverage, implementation, exact-head CI and final visual inspection are pending. Merge remains gated by explicit user approval.
