# Sticky Receipt Review Context

## Request

Keep receipt evidence and the calculated total continuously available while users review and correct ticket lines. Desktop should behave like a two-column review workspace with sticky evidence and sticky summary. Mobile should preserve editing space with compact sticky evidence and a sticky total/action summary, without covering focused controls, the bottom navigation, or the software keyboard.

## Evidence

- The previous review already used a two-column layout from 50rem upward and made the desktop evidence column sticky, but the calculated total scrolled away with the receipt rows.
- On compact screens the full receipt image remained in normal document flow, so the persistent representation needed to be compact rather than making the large image itself sticky.
- `#confirm-receipt` is the single canonical confirmation action and `.review-total` is the canonical calculated-total presentation; the implementation moves/reuses these nodes rather than duplicating calculation or confirmation logic.
- Multi-image review persists `state.selectedReviewCaptureKey`, and `renderReviewReference()` remains the owner that updates the selected evidence.
- The existing capture preview dialog is the canonical enlarged-image viewer and is reused rather than introducing a second preview implementation.
- A tests-only run reproduced the missing feature without regressions: all 39 pre-existing browser flows passed while only the two new sticky-context acceptance tests failed because the compact evidence strip and sticky summary did not yet exist.
- The first implementation run reduced the remaining failures to mobile focus visibility plus a stale legacy locator. Desktop sticky review already passed. The legacy test was corrected to consume the moved canonical total, while production received explicit mobile focus recovery based on the sticky summary, bottom navigation and `VisualViewport`.
- The next run executed all 41 functional browser flows successfully and exposed only one uncovered defensive branch in sticky-summary teardown; dedicated boundary coverage was added without weakening the branch threshold.
- Exact implementation head `10e7d57aec3d7217ba35ffdf622f62e8629c8f57` passed the full browser suite with 42/42 tests and 100% browser changed-code coverage across 224 lines, 14 functions and 22 branches.
- Manual inspection of the exact-head browser artifact confirmed the compact mobile sticky evidence plus total/state/CTA remain visible while receipt lines scroll, and the desktop evidence rail plus summary remain pinned while the editor is scrolled to later receipt lines.

## Decision

- Preserve one review information architecture across breakpoints: selected evidence, calculated total/validation state, editable rows, then secondary/manual controls.
- Desktop keeps the two-column review body. The evidence column remains sticky below the application header and the calculated-total/confirmation summary is independently sticky in the editor column.
- Compact/mobile layouts retain the full selected evidence in normal document flow for direct review, but add a separate compact sticky evidence strip containing a thumbnail, selected capture identity and an explicit `Ampliar captura` action. The existing capture selector remains available for multi-image switching.
- Mobile places the sticky total/confirmation summary below the compact evidence using a top sticky offset rather than a fixed bottom overlay. This keeps the summary continuously visible while avoiding bottom-navigation and virtual-keyboard collisions.
- The existing `.review-total` node and `#confirm-receipt` button are moved into one `#receipt-review-sticky-summary` container after every review render; total calculation and confirm behavior remain single-source.
- `Ampliar captura` reuses the existing capture preview dialog. PDF evidence remains represented as a document reference and does not invent an image preview.
- Mobile editable controls use sticky-aware scroll margins plus focused-control recentering inside the actual visual viewport, repeated after the keyboard-settle interval, so focus cannot remain hidden below the review context or software keyboard.
- Sticky-summary synchronization keeps a defensive partial-DOM-teardown guard because the review can be reset while observers are active; browser boundary coverage exercises each missing-node path.
- Service-worker shell revision `basketra-shell-v17` carries the new receipt JS/CSS into installed PWA clients without changing caching policy.
- No OCR, AI, backend, database, confirmation API, persistence, authentication or dependency contract changes are part of this task.

## Acceptance

1. Desktop review at >= 50rem remains a two-column layout with selected evidence sticky while receipt rows scroll.
2. Desktop calculated total, validation state and `Confirmar e importar` remain visible in a sticky editor summary while reviewing long receipts.
3. Mobile review has a compact sticky evidence strip rather than a large sticky image; it includes a thumbnail, current capture identity and `Ampliar captura` for images while the full evidence remains available in normal flow.
4. Mobile calculated total, validation state and the canonical confirmation button remain sticky and visible without overlapping bottom navigation.
5. The mobile sticky strategy uses top offsets, focus scroll margins and visual-viewport-aware focus recovery so focused controls are not hidden behind sticky review UI or the software keyboard.
6. Switching the selected reference capture updates the sticky evidence identity/thumbnail and preserves edited receipt rows.
7. Enlarged image review uses the existing capture preview dialog.
8. Confirm/import continues to use the existing `#confirm-receipt` action and `/api/v1/receipts/confirm` flow.
9. Automatic OCR, optional non-blocking AI correction, manual recovery, grouped disclosures, two-slot pool behavior and completed-progress cleanup remain unchanged.
10. Browser zoom, safe-area handling, touch targets, keyboard focus, reduced motion and no-horizontal-overflow behavior remain intact.
11. Browser E2E covers compact mobile sticky evidence/summary, desktop sticky evidence/summary, capture switching with preserved edits, focus visibility, defensive teardown and successful confirmation.
12. Canonical quality, browser diff coverage, security, container smoke/builds, CodeQL and exact-head visual evidence pass before delivery.

## Checks

Implementation head `10e7d57aec3d7217ba35ffdf622f62e8629c8f57`:

- Pull Request Quality run `32297618360`: Quality, Browser E2E, Security, container smoke, linux/amd64 and linux/arm64 all passed.
- Browser E2E job `96212516049`: 42/42 Chromium tests passed.
- Browser changed-code coverage: 100% across 224 changed lines, 14 functions and 22 branches.
- CodeQL Advanced run `32297618326`: passed.
- Publish PR visual evidence run `32297618192`: passed against the same implementation head.
- Exact-head browser artifact `9381859558` was downloaded and manually inspected for mobile and desktop sticky review behavior.

## Delivery

Implemented on PR #32 (`agent/ui-android-native-redesign`) through atomic Conventional Commits:

- `06a7422a` `docs(spec): define sticky receipt review context`
- `775475d1` `test(receipts): require sticky review context`
- `bdd986e5` `test(receipts): target compact mobile sticky evidence`
- `b28c20e2` `feat(receipts): keep review context sticky`
- `0daaa7cb` `fix(receipts): keep mobile review focus visible`
- `492b1654` `test(receipts): verify focused fields stay visible`
- `b5fdde69` `test(receipts): assert canonical sticky total`
- `10e7d57a` `test(receipts): cover sticky summary teardown`

No merge, release, deployment, migration, dependency or API-contract operation is part of this task.

## Status

Implementation, regression coverage, exact-head CI and manual visual inspection are complete. Final documentation head still requires its exact CI pass. Merge remains gated by explicit user approval.
