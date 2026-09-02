# Receipt line editor invoice redesign

## Request

Redesign the receipt-line editor approved from the visual mock so it reads like a compact invoice instead of placing product, quantity, unit price, discount controls, affected units and total in one horizontal row.

The redesign must work on mobile and desktop, preserve the existing receipt calculation/validation behavior, and make the hierarchy immediately understandable: product, purchase detail, discount, calculated summary, then actions.

After hands-on validation of the branch, the calculated summary must also remain visually stable while quantity, unit price or discount inputs trigger an asynchronous recalculation. The summary must not collapse, expand or replace its complete surface while waiting; only the status/progress affordance and the final numeric values may change. Very large but valid monetary values must remain readable and contained without overlapping labels or escaping the summary width.

## Evidence

- The current desktop dialog uses the same `.quantity-row` for quantity, unit price, discount type, discount value, affected units and total.
- At desktop widths this produces a dense six-column form with weak grouping and high cognitive load.
- The approved mock separates the editor into three logical form sections plus a prominent invoice-style summary, with a single-column mobile adaptation.
- Existing backend-derived totals, partial-unit discounts, stale-safe calculations, cancel restoration and validation are already correct and must not be reimplemented.
- Local branch validation shows the invoice hierarchy is useful, but pending calculation currently changes the visible contents of the summary enough to create a shrink/expand effect instead of a stable in-place update.
- The same validation reproduced an extreme-value overflow with quantity `99999`, unit price `99999999`, 100% discount and all units affected: subtotal/discount labels and values compete for the narrow desktop summary column.
- Exact-head Browser E2E at `25cfd4ec8b586bfd9e055fa27cd58b6b1e968649` passes 82/83 tests; the only failing assertion is the mobile sheet bottom geometry at 390 × 1024. The next regression must report the measured dialog/actions boxes instead of returning only a boolean.

## Decision

1. Keep the existing `receipt-item` fields and backend calculation flow as the source of truth; this PR changes presentation and editor composition only.
2. The editor form is grouped into three semantic sections: `Producto`, `Detalle de compra`, and `Descuento`.
3. Desktop uses a two-area layout: form sections on the left and a compact invoice summary on the right.
4. Mobile uses one vertical flow with the summary immediately after the discount section; no horizontal field grid is required.
5. The summary derives its base amount and applied discount from the current quantity, unit-price and backend-derived total values using integer minor-unit presentation arithmetic. It does not recalculate discount rules.
6. Validation state appears in the dialog header and in the summary without removing the canonical validation control from the underlying receipt line.
7. Existing controls retain their current `data-field` attributes, labels, keyboard behavior, focus management, stale-safe calculation handling and save/cancel/delete semantics.
8. Delete remains visually secondary/destructive, Cancel remains neutral, and Save remains the dominant action.
9. The layout must support light/dark themes, keyboard focus, reduced motion, 320-430 px mobile widths, tablet and desktop without horizontal overflow.
10. A recalculation reuses the existing summary DOM. Pending state preserves the last settled values, reserves the same summary/status geometry and exposes a concise calculating indicator; completion updates the canonical numeric text in place.
11. Desktop summary rows may reflow label above value so each amount can consume the complete column width. Amount typography may become more compact for unusually long localized values, but values must remain visible, untruncated and contained.
12. The mobile bottom-sheet regression must measure and report `dialogBox`, `actionsBox` and the residual bottom gap after two animation frames; layout or assertion changes must follow that measured evidence.
13. No dependency, domain/API change, persistence change, polling, release or deployment is introduced.

## Acceptance

- Opening a receipt line editor no longer displays all purchase/discount fields in one horizontal row.
- Desktop visibly groups Product, Purchase detail and Discount and displays a separate invoice summary with base amount, applied discount and calculated total.
- Mobile displays the same information in a single readable vertical flow with touch-safe controls.
- A quantity-2 line with a 50% discount on one unit continues to show the backend-derived total 2.62 EUR.
- The summary shows a 3.50 EUR base amount and -0.88 EUR applied discount for that scenario without duplicating the discount formula.
- Whole-line and no-discount states remain readable and do not leave empty layout holes.
- While a recalculation request is intentionally held pending, the same summary element remains mounted and its outer width/height do not visibly change; a professional calculating indicator is visible and the previous settled numbers remain readable until the response arrives.
- After the pending response completes, only the displayed numbers/status change; Save, validation and stale-response protection follow the canonical backend result.
- Quantity `99999`, unit price `99999999`, 100% discount and `99999` affected units render subtotal `9.999.899.900.001,00 €`, the equivalent negative applied discount and total `0,00 €` without horizontal overflow, label/value overlap or clipping on desktop and mobile.
- Save, Cancel, Delete, validation, calculation error blocking and stale-response protection continue to behave exactly as before.
- No horizontal overflow at 320, 360, 390, 430 and 1280 px viewports.
- Browser evidence includes mobile and desktop screenshots of the redesigned partial-unit editor.

## Checks

- [ ] browser regression for semantic editor sections and summary
- [ ] browser regression for stable pending-summary geometry and same-node in-place update
- [ ] browser regression for extreme localized monetary values on desktop and mobile
- [ ] browser regression for 320/360/390/430 px overflow
- [ ] browser regression for desktop two-area layout
- [ ] mobile 390 × 1024 failure reports exact dialog/actions geometry and bottom gap
- [ ] existing partial-unit discount E2E remains green
- [ ] existing cancel/error/validation E2E remains green
- [ ] `pnpm quality`
- [ ] Browser E2E
- [ ] Security / CodeQL / containers
- [ ] manual visual review of desktop and mobile screenshots
- [ ] final diff / PR / review-thread inspection

## Delivery

- Branch: `agent/feat-receipt-editor-invoice-ui`
- Base: `main` after PR #47 (`652a1a8f55cd08cdb7b30c6377ec8e8bc643272d`)
- Merge/release/deploy: requires explicit approval.
- Rollback: revert this PR; no persistence or API migration is involved.

## Status

Reopened after local visual validation. The invoice hierarchy is accepted, while summary stability, extreme-value containment and the remaining mobile sheet geometry regression are pending exact-head implementation and validation.
