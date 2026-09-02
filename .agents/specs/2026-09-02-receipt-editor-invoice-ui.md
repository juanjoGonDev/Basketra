# Receipt line editor invoice redesign

## Request

Redesign the receipt-line editor approved from the visual mock so it reads like a compact invoice instead of placing product, quantity, unit price, discount controls, affected units and total in one horizontal row.

The redesign must work on mobile and desktop, preserve the existing receipt calculation/validation behavior, and make the hierarchy immediately understandable: product, purchase detail, discount, calculated summary, then actions.

After hands-on validation of the branch, the calculated summary must also remain visually stable while quantity, unit price or discount inputs trigger an asynchronous recalculation. The summary must not collapse, expand or replace its complete surface while waiting; only the status/progress affordance and the final numeric values may change. Very large but valid monetary values must remain readable and contained without overlapping labels or escaping the summary width.

## Evidence

- The original desktop dialog used the same `.quantity-row` for quantity, unit price, discount type, discount value, affected units and total, producing a dense six-column form with weak grouping.
- The approved mock separates the editor into three logical form sections plus a prominent invoice-style summary, with a single-column mobile adaptation.
- Existing backend-derived totals, partial-unit discounts, stale-safe calculations, cancel restoration and validation remain authoritative and are not reimplemented.
- Hands-on validation of the first invoice iteration showed a visible shrink/expand effect while a calculation was pending because the summary changed its visible structure instead of updating in place.
- The same validation reproduced an extreme-value overflow with quantity `99999`, unit price `99999999`, 100% discount and all units affected: subtotal/discount labels and values competed for the narrow desktop summary column.
- Browser E2E now holds the calculation response deliberately and proves the same summary DOM node and outer geometry remain stable while the previous settled values stay visible and `Calculando total…` is shown.
- Browser E2E now exercises quantity `99999`, unit price `99999999`, 100% discount and `99999` affected units on desktop and mobile, including containment and non-overlap assertions.
- The previous mobile bottom-sheet failure is now measured directly. On product-code head `0c4a039ad25801d5ecea27fc25a2f2e3d7cc6e12`, 390 × 1024 reports dialog bottom `1024`, actions bottom `1023` and residual gap `1` px.
- Pull Request Quality run `33622866688` passes all 85 Browser E2E tests plus Quality, Security, container smoke and both container architectures. CodeQL run `33622866635` also succeeds.
- Publish PR visual evidence run `33622866637` succeeds and publishes the invoice desktop, mobile and error screenshots from product-code head `0c4a039ad25801d5ecea27fc25a2f2e3d7cc6e12` to the temporary `pr-48-visual-evidence` release.
- The raw browser artifact is `544464094` bytes, which exceeds the connector download limit of `536870912` bytes. The connector can verify the release assets and their digests but cannot ingest those PNG binaries for a pixel-level agent review.

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
11. Desktop summary rows reflow label above value so each amount can consume the complete column width. Amount typography becomes more compact only for unusually long localized values; values remain visible, untruncated and contained.
12. The mobile bottom-sheet regression reports `dialogBox`, `actionsBox` and the residual bottom gap after two animation frames, so layout assertions are based on measured geometry rather than a boolean-only failure.
13. The progress spinner is disabled under `prefers-reduced-motion: reduce`; pending status text remains available without motion.
14. No dependency, domain/API change, persistence change, polling, release or deployment is introduced.

## Acceptance

- Opening a receipt line editor no longer displays all purchase/discount fields in one horizontal row.
- Desktop visibly groups Product, Purchase detail and Discount and displays a separate invoice summary with base amount, applied discount and calculated total.
- Mobile displays the same information in a single readable vertical flow with touch-safe controls.
- A quantity-2 line with a 50% discount on one unit continues to show the backend-derived total 2.62 EUR.
- The summary shows a 3.50 EUR base amount and -0.88 EUR applied discount for that scenario without duplicating the discount formula.
- Whole-line and no-discount states remain readable and do not leave empty layout holes.
- While a recalculation request is intentionally held pending, the same summary element remains mounted and its outer width/height do not visibly change; a calculating indicator is visible and the previous settled numbers remain readable until the response arrives.
- After the pending response completes, only the displayed numbers/status change; Save, validation and stale-response protection follow the canonical backend result.
- Quantity `99999`, unit price `99999999`, 100% discount and `99999` affected units render subtotal `9.999.899.900.001,00 €`, the equivalent negative applied discount and total `0,00 €` without horizontal overflow, label/value overlap or clipping on desktop and mobile.
- Save, Cancel, Delete, validation, calculation error blocking and stale-response protection continue to behave exactly as before.
- No horizontal overflow at 320, 360, 390, 430 and 1280 px viewports.
- Browser evidence includes mobile and desktop screenshots of the redesigned partial-unit editor.

## Checks

- [x] browser regression for semantic editor sections and summary
- [x] browser regression for stable pending-summary geometry and same-node in-place update
- [x] browser regression for extreme localized monetary values on desktop and mobile
- [x] browser regression for 320/360/390/430 px overflow
- [x] browser regression for desktop two-area layout
- [x] mobile 390 × 1024 reports exact dialog/actions geometry and bottom gap
- [x] existing partial-unit discount E2E remains green
- [x] existing cancel/error/validation E2E remains green
- [x] `pnpm quality` equivalent exact CI Quality gate
- [x] Browser E2E: 85/85 on run `33622866688`
- [x] Security / CodeQL / containers on product-code head
- [x] exact-head visual evidence published for desktop, mobile and error states
- [ ] manual pixel-level visual review of the published exact-head screenshots by the agent; blocked because the GitHub connector cannot ingest release binaries and the browser artifact exceeds its download limit
- [x] PR review-thread inspection: no review threads are open

## Delivery

- Branch: `agent/feat-receipt-editor-invoice-ui`
- Base: `main` after PR #47 (`652a1a8f55cd08cdb7b30c6377ec8e8bc643272d`)
- Product-code head validated by all applicable checks: `0c4a039ad25801d5ecea27fc25a2f2e3d7cc6e12`.
- Merge/release/deploy: requires explicit approval.
- Rollback: revert this PR; no persistence or API migration is involved.

## Status

Implementation and automated validation are complete for the requested stable recalculation UX, extreme monetary-value containment and mobile sheet geometry. Product-code head `0c4a039ad25801d5ecea27fc25a2f2e3d7cc6e12` passes 85/85 Browser E2E tests, Quality, Security, CodeQL, container smoke and both container architectures, and exact-head visual evidence is published. Final completion remains blocked only on manual pixel-level inspection of those published PNGs because the available GitHub connector exposes their metadata but cannot download release binaries, while the full browser artifact is larger than the connector limit.
