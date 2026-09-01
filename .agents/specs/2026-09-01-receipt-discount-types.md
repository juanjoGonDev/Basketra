# Receipt discount types

## Request

Support explicit and exclusive receipt-line discounts as no discount, fixed EUR amount, or percentage. Keep receipt arithmetic owned by the backend/domain, teach structured AI extraction the same tagged contract, surface ambiguous visible discounts for manual review instead of guessing, and provide a clear responsive editor whose derived total is not presented as editable input.

## Evidence

- Receipt-line arithmetic previously accepted only `discountMinor`, so percentage intent could not be represented directly.
- `/api/v1/receipts/calculate-line` previously exposed the same amount-only contract.
- AI receipt verification previously modeled only amount discounts.
- The receipt editor exposed a single `Descuento (€)` input and made the derived line total look editable.
- Persisted `receipt_items.discount_minor` is the effective monetary amount consumed by existing receipt/history logic; immutable extraction/correction JSON can retain richer typed intent, so a schema migration is not required.
- A real Alcampo pattern such as `50% dto BEBIDA COCO 0% A 0,88-` demonstrates percentage evidence. When duplicate identical product lines exist, ownership is ambiguous and must remain unassigned for review.

## Decision

1. The canonical typed discount contract is `{ type: 'amount', amountMinor }` or `{ type: 'percentage', basisPoints }`; absence means no discount.
2. Legacy `discountMinor` remains accepted at compatibility boundaries, but mixed legacy and tagged representations are rejected.
3. `calculateReceiptLineTotal()` remains the arithmetic SSOT. Percentage math uses integer basis points (`10_000 = 100%`), `BigInt`, and half-up cent rounding.
4. Domain validation rejects negative or unsafe integers, percentages above 100%, discounts above the subtotal, mixed representations, malformed tagged objects, and safe-integer overflow.
5. `/api/v1/receipts/calculate-line` returns the domain-derived `lineTotalMinor` plus the resolved monetary `discountMinor`; the browser never reimplements the calculation.
6. Structured AI output uses the same tagged discount shape and is validated locally before use.
7. Visible discounts whose owner cannot be determined uniquely are returned as bounded `unassignedDiscounts` evidence and surfaced for manual review instead of being attached arbitrarily.
8. No database migration or historical evidence rewrite is introduced. `receipt_items.discount_minor` remains the confirmed effective monetary projection while typed intent is retained in AI/correction JSON.
9. The editor exposes one exclusive discount-type selector and one contextual value field. Switching between percentage and amount discards the old type's value, resets the new type to a safe typed zero, and immediately requests a backend recalculation. Choosing no discount removes the value. Cancel restores the original type/value and invalidates any edited calculation still in flight before recalculating the restored state.
10. The line total is rendered as semantic `<output>` with live derived-calculation state; obsolete editable-total guidance is removed.
11. Quantity, unit price, discount type, and discount value drive bounded abortable backend recalculation. Stale responses are ignored, and save/validate/confirm actions are blocked while the latest result is pending or failed.
12. Existing `receipt-review.css` owns the responsive discount-editor styling; no extra public stylesheet or static-asset allowlist expansion is required.
13. The service-worker shell is versioned so clients receive the updated editor assets.
14. No dependency is added.

## Acceptance

- A line can represent no discount, a fixed amount, or a percentage, never multiple discount forms simultaneously.
- Percentage arithmetic is exact in basis points and uses deterministic half-up cent rounding without binary floating-point percentage math.
- 0%, 100%, cent-rounding boundaries, invalid ranges, discount-over-subtotal, malformed/mixed contracts, unsafe integers, and overflow are covered.
- Legacy amount-only input remains compatible at supported boundaries.
- AI structured output accepts typed discounts, rejects malformed/mixed values, and never guesses ownership for ambiguous duplicate-item discount evidence.
- Confirmation persists the locally resolved monetary amount while preserving typed correction/evidence intent.
- The editor has one discount selector, one contextual value, and a clearly read-only semantic derived total.
- Changing discount type never reuses the previous type's numeric meaning and triggers backend calculation immediately with a typed zero.
- Pending/failed derived calculations block save, line validation, whole-ticket validation, and confirmation.
- Older or aborted calculation responses cannot overwrite newer intent, including after Cancel restores the original line state.
- Cancel restores the pre-edit discount type, value, and derived total.
- The ambiguous-discount warning remains visible and actionable for manual review.
- Mobile and desktop receipt editing have no horizontal overflow and retain usable targets, focus behavior, and labels.
- Service-worker shell and server static-asset contracts remain coherent.
- No dependency or database migration is introduced.

## Checks

- [ ] `pnpm quality`
- [ ] domain coverage remains 100% lines/functions/branches
- [ ] browser E2E for amount, percentage, type switching, pending/error blocking, confirmation, and Cancel race
- [ ] container smoke on final head
- [ ] linux/amd64 container build on final head
- [ ] linux/arm64 container build on final head
- [ ] security checks on final head
- [ ] CodeQL on final head
- [ ] visual evidence workflow for the exact functional head
- [ ] desktop/mobile screenshot review: alignment, overflow, spacing, semantic output, controls, pending/error states, focus and responsive behavior
- [ ] final diff/PR/review-thread inspection

## Delivery

- Branch: `agent/fix-receipt-discount-types`
- Pull request: #46
- Merge/release/deploy: prohibited for this task.
- Rollback: revert the PR; persisted historical `discount_minor` data remains unchanged because no migration is applied.

## Status

Implementation and regression coverage are in place. CI and final visual review remain authoritative before completion. A prior coverage run identified only the malformed-container guard in `parseReceiptLineDiscount`; focused public-contract coverage was added before these documentation-only updates.
