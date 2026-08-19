# Sticky Receipt Review Context

## Request

Keep receipt evidence and the calculated total continuously available while users review and correct ticket lines. Desktop should behave like a two-column review workspace with sticky evidence and sticky summary. Mobile should preserve editing space with compact sticky evidence and a sticky total/action summary, without covering focused controls, the bottom navigation, or the software keyboard.

## Evidence

- The current review already uses a two-column layout from 50rem upward and makes the desktop evidence column sticky, but the calculated total scrolls away with the receipt rows.
- On compact screens the full receipt image remains in normal document flow and can consume a large share of the viewport before line editing begins.
- `#confirm-receipt` is already the single canonical confirmation action and `.review-total` is the canonical calculated-total presentation; the implementation must move/reuse these nodes rather than duplicate calculation or confirmation logic.
- Multi-image review already persists `state.selectedReviewCaptureKey`, and `renderReviewReference()` is the owner that updates the selected evidence.
- The existing capture preview dialog is the canonical enlarged-image viewer and should be reused rather than introducing a second preview implementation.

## Decision

- Preserve one review information architecture across breakpoints: selected evidence, calculated total/validation state, editable rows, then secondary/manual controls.
- Desktop keeps the existing two-column review body. The evidence column remains sticky below the application header and the calculated-total/confirmation summary becomes independently sticky in the editor column.
- Compact/mobile layouts replace the large inline evidence image with a sticky compact evidence strip containing a thumbnail, selected capture identity and an explicit `Ampliar captura` action. The existing capture selector remains available for multi-image switching.
- Mobile places the sticky total/confirmation summary below the compact evidence using a top sticky offset rather than a fixed bottom overlay. This keeps the summary continuously visible while avoiding bottom-navigation and virtual-keyboard collisions.
- The existing `.review-total` node and `#confirm-receipt` button are moved into one `#receipt-review-sticky-summary` container after every review render; total calculation and confirm behavior remain single-source.
- `Ampliar captura` reuses the existing capture preview dialog. PDF evidence remains represented as a document reference and does not invent an image preview.
- Focusable review/manual controls receive scroll margin accounting for the sticky mobile review context so keyboard/focus navigation cannot land underneath it.
- No OCR, AI, backend, database, confirmation API, persistence, authentication or dependency contract changes are part of this task.

## Acceptance

1. Desktop review at >= 50rem remains a two-column layout with selected evidence sticky while receipt rows scroll.
2. Desktop calculated total, validation state and `Confirmar e importar` remain visible in a sticky editor summary while reviewing long receipts.
3. Mobile review shows a compact sticky evidence strip rather than a large sticky image; it includes a thumbnail, current capture identity and `Ampliar captura` for images.
4. Mobile calculated total, validation state and the canonical confirmation button remain sticky and visible without overlapping bottom navigation.
5. The mobile sticky strategy uses top offsets and focus scroll margins so focused controls are not hidden behind sticky review UI and does not depend on covering the software keyboard area.
6. Switching the selected reference capture updates the sticky evidence identity/thumbnail and preserves edited receipt rows.
7. Enlarged image review uses the existing capture preview dialog.
8. Confirm/import continues to use the existing `#confirm-receipt` action and `/api/v1/receipts/confirm` flow.
9. Automatic OCR, optional non-blocking AI correction, manual recovery, grouped disclosures, two-slot pool behavior and completed-progress cleanup remain unchanged.
10. Browser zoom, safe-area handling, touch targets, keyboard focus, reduced motion and no-horizontal-overflow behavior remain intact.
11. Browser E2E covers compact mobile sticky evidence/summary, desktop sticky evidence/summary, capture switching with preserved edits, focus visibility and successful confirmation.
12. Canonical quality, browser diff coverage, security, container smoke/builds, CodeQL and exact-head visual evidence all pass before delivery.

## Checks

- `pnpm quality` and project resource/growth budgets.
- Browser E2E at mobile and desktop widths, including sticky geometry, capture switching, edit preservation, enlarged preview and confirmation.
- Browser changed-code coverage at the project threshold.
- Security, container smoke, linux/amd64, linux/arm64 and CodeQL.
- Exact-head PR visual-evidence publication and manual inspection of the receipt review workspace.

## Delivery

Implement on PR #32 (`agent/ui-android-native-redesign`) through atomic Conventional Commits. Do not merge, release or deploy.

## Status

Specified. Tests, implementation, exact-head CI and visual review pending.
