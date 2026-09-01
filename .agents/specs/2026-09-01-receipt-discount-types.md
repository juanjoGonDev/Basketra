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
12. Text and numeric calculation inputs recalculate on `input`; the discount-type selector recalculates on `change`. This avoids a duplicate blur-triggered calculation from re-blocking Save after the same value already produced a valid result.
13. Existing `receipt-review.css` owns the responsive discount-editor styling; no extra public stylesheet or static-asset allowlist expansion is required.
14. The service-worker shell is versioned so clients receive the updated editor assets.
15. Browser evidence uses explicit state-specific screenshots rather than relying on each test's incidental final screenshot.
16. No dependency is added.

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
- Losing focus from an already calculated numeric field does not start a duplicate calculation that re-blocks Save.
- Cancel restores the pre-edit discount type, value, and derived total.
- The ambiguous-discount warning remains visible and actionable for manual review.
- Mobile and desktop receipt editing have no horizontal overflow and retain usable targets, focus behavior, and labels.
- Published visual evidence represents the named percentage, error, ambiguity, responsive, and cancel-restoration states explicitly.
- Service-worker shell and server static-asset contracts remain coherent.
- No dependency or database migration is introduced.

## Checks

- [x] `pnpm quality`
- [x] domain coverage remains 100% lines/functions/branches
- [x] browser E2E for amount, percentage, type switching, pending/error blocking, confirmation, and Cancel race
- [x] container smoke on final functional head
- [x] linux/amd64 container build on final functional head
- [x] linux/arm64 container build on final functional head
- [x] security checks on final functional head
- [x] CodeQL on final functional head
- [x] visual evidence workflow for the exact functional head
- [x] desktop/mobile screenshot review: alignment, overflow, spacing, semantic output, controls, pending/error states, focus and responsive behavior
- [x] final functional diff/PR/review-thread inspection
- [x] documentation-only head revalidation after recording functional evidence

## Validation evidence

- Final functional head: `57f18886b254b28d68a3bb52542dd5240a315b26`.
- Pull Request Quality run: `33527462280` (success).
  - `pnpm quality`: success.
  - Unit tests: 223/223 passed.
  - Integration tests: 53/53 passed.
  - Repository E2E test: 1/1 passed.
  - Domain coverage: 100% lines, functions, and branches for every `src/domain` module.
  - Browser E2E: 77/77 passed with retries disabled.
  - Container smoke: success.
  - linux/amd64 and linux/arm64 container builds: success.
  - Security policy/secret scan and production dependency audit: success.
- CodeQL run: `33527462364` (success).
- Visual evidence workflow: `33527462405` (success), consuming the successful browser artifact from the same functional head.
- Browser evidence artifact: `9808531539`, digest `sha256:a81fdeb4449e443349b5ae01cc51a397dfe296244a6e289fe7f6cb9adca883a5`.
- Manual review inspected the explicit percentage editor, failed-calculation state with full-width error and disabled Save, duplicate-item ambiguity warning, mobile responsive editor, desktop responsive editor, and Cancel-restored state. No horizontal-overflow or alignment regression was found in the reviewed states.
- The Cancel E2E additionally asserts the restored percentage type, `50` value, `0.87` derived total, focus restoration, and protection against the late edited calculation after the dialog closes.
- PR #46 was open, non-draft, mergeable, scoped to 25 discount/evidence/test files, and had no review threads at final functional-head inspection.

### Documentation-head revalidation

- Evidence-recording head: `690d0b01cecaea5177b2f84b8313a5073d3a3cf3`.
- It is exactly one commit ahead of the validated functional head and changes only `.agents/specs/2026-09-01-receipt-discount-types.md`.
- Pull Request Quality run: `33528832231` (success), including Quality, Browser E2E, Security, container smoke, linux/amd64 and linux/arm64.
- CodeQL run: `33528832052` (success).
- Visual evidence workflow: `33528832213` (success).
- Browser evidence artifact: `9809047939`, digest `sha256:d99e17ddc4100a13ca8d05e00a5769663ac9f77eedeefc0683e4915c93c326ee`.
- The exact-head percentage, error, ambiguity, mobile, desktop and Cancel-restoration captures were reviewed again and remained clean.
- PR #46 remained open, non-draft and mergeable with no review threads or submitted reviews.

## Delivery

- Branch: `agent/fix-receipt-discount-types`
- Pull request: #46
- Merge/release/deploy: prohibited for this task.
- Rollback: revert the PR; persisted historical `discount_minor` data remains unchanged because no migration is applied.
- The final status-recording commit is documentation-only. Repository exact-head CI remains the external delivery gate for that commit; the PR validation section is the delivery SSOT for its final SHA and run results.

## Status

The requested receipt-discount work is complete: implementation, regression coverage, exact functional-head CI, CodeQL, explicit visual evidence, manual desktop/mobile review, PR inspection, and the subsequent documentation-head revalidation all passed. No merge, release, deployment, dependency addition, or database migration is part of this task.
