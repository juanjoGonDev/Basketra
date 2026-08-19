# Sticky Receipt Review Context

## Request

Keep receipt evidence and the calculated total continuously available while users review and correct ticket lines. Desktop should behave like a two-column review workspace with sticky evidence and sticky summary. Mobile should preserve editing space with compact sticky evidence and a sticky total/action summary, without covering focused controls, the bottom navigation, or the software keyboard.

Follow-up feedback requires the sticky review context to visibly use Basketra's existing iconography rather than read as a text-only add-on. The compact evidence action and validation state must expose clear SVG affordances while retaining visible text.

## Evidence

- The previous review already used a two-column layout from 50rem upward and made the desktop evidence column sticky, but the calculated total scrolled away with the receipt rows.
- On compact screens the full receipt image remained in normal document flow, so the persistent representation needed to be compact rather than making the large image itself sticky.
- `#confirm-receipt` is the single canonical confirmation action and `.review-total` is the canonical calculated-total presentation; the implementation moves/reuses these nodes rather than duplicating calculation or confirmation logic.
- Multi-image review persists `state.selectedReviewCaptureKey`, and `renderReviewReference()` remains the owner that updates the selected evidence.
- The existing capture preview dialog is the canonical enlarged-image viewer and is reused rather than introducing a second preview implementation.
- `src/web/ui.js` already owns Basketra's inline SVG icon library and `icon()` renderer, including the existing `image`, `check` and `alert` glyphs. Reusing that owner avoids a second icon family, font, package or asset pipeline.
- Exact-head evidence before the follow-up showed icons rendering correctly in navigation, capture actions and the confirmation CTA, while the newly added compact `Ampliar` action and sticky validation pill were text-only. The defect was therefore local to the new sticky review chrome rather than a global icon-rendering failure.
- Tests-only head `67d1b420d99088b38656027e45fb6459de6a5407` reproduced the feedback: all 42 existing browser flows passed and only the new icon acceptance test failed because `Ampliar captura` had no `.icon` descendant.
- Implementation head `cf971e7b09309db9a23d1ed299dffe8b5434a140` rendered the canonical icons and passed all 43 browser flows. The browser diff-coverage gate then identified one unexercised branch for the warning-state icon, so the tests were extended rather than weakening coverage.
- Follow-up head `b98b01166d919e0013dab8f1bc55faca8e4e3853` covers both validated and warning states and passed 43/43 Chromium tests with 100% changed-code coverage across 228 lines, 14 functions and 25 branches.
- Exact-head artifact `9384254859` was downloaded and manually inspected. Mobile review visibly shows the existing image glyph beside `Ampliar`, the check glyph beside `Total validado`, the current capture identity and the sticky calculated total while the preview action remains usable.

## Decision

- Preserve one review information architecture across breakpoints: selected evidence, calculated total/validation state, editable rows, then secondary/manual controls.
- Desktop keeps the two-column review body. The evidence column remains sticky below the application header and the calculated-total/confirmation summary is independently sticky in the editor column.
- Compact/mobile layouts retain the full selected evidence in normal document flow for direct review, but add a separate compact sticky evidence strip containing a thumbnail, selected capture identity and an explicit `Ampliar captura` action. The existing capture selector remains available for multi-image switching.
- Mobile places the sticky total/confirmation summary below the compact evidence using a top sticky offset rather than a fixed bottom overlay. This keeps the summary continuously visible while avoiding bottom-navigation and virtual-keyboard collisions.
- The existing `.review-total` node and `#confirm-receipt` button are moved into one `#receipt-review-sticky-summary` container after every review render; total calculation and confirm behavior remain single-source.
- `Ampliar captura` reuses the existing capture preview dialog and the existing canonical `image` glyph. PDF evidence remains represented as a document reference and does not invent an image preview.
- Validation pills keep their visible Spanish label and semantic color while rendering the canonical `check` glyph for a valid total or `alert` glyph for a warning. Meaning therefore does not depend on color or icon alone.
- No icon-only replacement is introduced for important actions; visible text and accessible names remain intact. SVGs continue using the project `icon()` renderer, `viewBox`, `currentColor` and `.icon` sizing conventions.
- Mobile editable controls use sticky-aware scroll margins plus focused-control recentering inside the actual visual viewport, repeated after the keyboard-settle interval, so focus cannot remain hidden below the review context or software keyboard.
- Sticky-summary synchronization keeps a defensive partial-DOM-teardown guard because the review can be reset while observers are active; browser boundary coverage exercises each missing-node path.
- Service-worker shell revision `basketra-shell-v18` invalidates installed-client shell caches for the receipt JS change without changing cache policy.
- No OCR, AI, backend, database, confirmation API, persistence, authentication or dependency contract changes are part of this task.

## Acceptance

1. Desktop review at >= 50rem remains a two-column layout with selected evidence sticky while receipt rows scroll.
2. Desktop calculated total, validation state and `Confirmar e importar` remain visible in a sticky editor summary while reviewing long receipts.
3. Mobile review has a compact sticky evidence strip rather than a large sticky image; it includes a thumbnail, current capture identity and `Ampliar captura` while the full evidence remains available in normal flow.
4. `Ampliar captura` contains a visible canonical SVG image icon plus visible text; no separate icon library, font or external asset is introduced.
5. Sticky validation state contains a visible canonical `check` or `alert` SVG plus the existing text label; meaning never depends only on icon or color.
6. Mobile calculated total, validation state and the canonical confirmation button remain sticky and visible without overlapping bottom navigation.
7. The mobile sticky strategy uses top offsets, focus scroll margins and visual-viewport-aware focus recovery so focused controls are not hidden behind sticky review UI or the software keyboard.
8. Switching the selected reference capture updates the sticky evidence identity/thumbnail and preserves edited receipt rows.
9. Enlarged image review uses the existing capture preview dialog.
10. Confirm/import continues to use the existing `#confirm-receipt` action and `/api/v1/receipts/confirm` flow.
11. Automatic OCR, optional non-blocking AI correction, manual recovery, grouped disclosures, two-slot pool behavior and completed-progress cleanup remain unchanged.
12. Browser zoom, safe-area handling, touch targets, keyboard focus, reduced motion and no-horizontal-overflow behavior remain intact.
13. Browser E2E covers compact mobile sticky evidence/summary, visible sticky-context icons in success and warning states, desktop sticky evidence/summary, capture switching with preserved edits, focus visibility, defensive teardown and successful confirmation.
14. Canonical quality, browser diff coverage, security, container smoke/builds, CodeQL and exact-head visual evidence pass before delivery.

## Checks

Icon implementation/test head `b98b01166d919e0013dab8f1bc55faca8e4e3853`:

- Pull Request Quality run `32304407989`: Quality, Browser E2E, Security, container smoke, linux/amd64 and linux/arm64 all passed.
- Browser E2E job `96233931679`: 43/43 Chromium tests passed.
- Browser changed-code coverage: 100% across 228 changed lines, 14 functions and 25 branches.
- CodeQL Advanced run `32304407957`: passed.
- Publish PR visual evidence run `32304407986`: passed against the same head.
- Exact-head browser artifact `9384254859` was downloaded and manually inspected for visible sticky review icons and unchanged mobile review geometry.

The final documentation-only head must repeat the canonical exact-head gates before delivery.

## Delivery

Implemented on PR #32 (`agent/ui-android-native-redesign`) through atomic Conventional Commits. Sticky-review and icon follow-up commits include:

- `06a7422a` `docs(spec): define sticky receipt review context`
- `775475d1` `test(receipts): require sticky review context`
- `bdd986e5` `test(receipts): target compact mobile sticky evidence`
- `b28c20e2` `feat(receipts): keep review context sticky`
- `0daaa7cb` `fix(receipts): keep mobile review focus visible`
- `492b1654` `test(receipts): verify focused fields stay visible`
- `b5fdde69` `test(receipts): assert canonical sticky total`
- `10e7d57a` `test(receipts): cover sticky summary teardown`
- `31efcec8` `docs(spec): reopen sticky review icon feedback`
- `67d1b420` `test(receipts): require visible sticky review icons`
- `cf971e7b` `fix(receipts): show sticky review icons`
- `b98b0116` `test(receipts): cover sticky warning icon`

No merge, release, deployment, migration, dependency or API-contract operation is part of this task.

## Status

Sticky review behavior and icon feedback are implemented, regression-covered and visually inspected. The final documentation-only head requires its exact CI pass before delivery. Merge remains gated by explicit user approval.
