# Receipt line editor invoice redesign

## Request

Redesign the receipt-line editor approved from the visual mock so it reads like a compact invoice instead of placing product, quantity, unit price, discount controls, affected units and total in one horizontal row.

The redesign must work on mobile and desktop, preserve the existing receipt calculation/validation behavior, and make the hierarchy immediately understandable: product, purchase detail, discount, calculated summary, then actions.

## Evidence

- The current desktop dialog uses the same `.quantity-row` for quantity, unit price, discount type, discount value, affected units and total.
- At desktop widths this produces a dense six-column form with weak grouping and high cognitive load.
- The approved mock separates the editor into three logical form sections plus a prominent invoice-style summary, with a single-column mobile adaptation.
- Existing backend-derived totals, partial-unit discounts, stale-safe calculations, cancel restoration and validation are already correct and must not be reimplemented.

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
10. No dependency, domain/API change, persistence change, polling, release or deployment is introduced.

## Acceptance

- Opening a receipt line editor no longer displays all purchase/discount fields in one horizontal row.
- Desktop visibly groups Product, Purchase detail and Discount and displays a separate invoice summary with base amount, applied discount and calculated total.
- Mobile displays the same information in a single readable vertical flow with touch-safe controls.
- A quantity-2 line with a 50% discount on one unit continues to show the backend-derived total 2.62 EUR.
- The summary shows a 3.50 EUR base amount and -0.88 EUR applied discount for that scenario without duplicating the discount formula.
- Whole-line and no-discount states remain readable and do not leave empty layout holes.
- Save, Cancel, Delete, validation, calculation error blocking and stale-response protection continue to behave exactly as before.
- No horizontal overflow at 320, 360, 390, 430 and 1280 px viewports.
- Browser evidence includes mobile and desktop screenshots of the redesigned partial-unit editor.

## Checks

- [ ] browser regression for semantic editor sections and summary
- [ ] browser regression for 320/360/390/430 px overflow
- [ ] browser regression for desktop two-area layout
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

Specification recorded. Implementation and exact-head validation pending.
