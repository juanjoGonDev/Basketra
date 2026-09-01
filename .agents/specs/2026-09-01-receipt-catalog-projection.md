# Receipt catalog projection

## Request

Confirmed ticket products must feed the global catalog automatically. The catalog must expose reusable canonical products/variants, retailer-specific names, and confirmed price observations by retailer/store so ticket analysis produces reusable shopping intelligence instead of an isolated receipt archive.

The same PR must also make receipt review behave like a compact inventory workflow: exact repeated purchase lines are represented once with their quantities summed, AI must actively read visible discounts, and a percentage or amount discount can apply to only part of an aggregated line quantity. For example, two identical 1.75 EUR products with a visible 50% discount on one unit must be represented as quantity 2 with a 50% discount affecting 1 unit, producing a 2.62 EUR line total.

## Evidence

- `BasketraDatabase.importReceipt()` persisted `receipts`, `receipt_extractions`, `receipt_items` and corrections, but inserted receipt items without `product_variant_id`.
- `/api/v1/catalog` reads `product_variants`/`canonical_products`; therefore confirmed receipt items did not appear unless a product was independently saved elsewhere.
- `CatalogRepository.confirmPriceObservation()` already owns immutable price evidence for explicit/manual flows, while ticket confirmation had no projection into that model.
- The deployed catalog could consequently show zero saved products while confirmed receipts existed.
- Existing databases require a historical backfill as well as fixing future receipt confirmations.
- The Alcampo receipt evidence contains two identical `BEBIDA COCO 0% A` rows at 1.75 EUR and a later `50% dto BEBIDA COCO 0% A 0,88-` line. AI detected the discount but returned it as unassigned because Basketra explicitly instructed duplicate identical products to be treated as ambiguous.
- The previous receipt domain applied one percentage discount to the complete line subtotal, so it could not express “50% on 1 of 2 units”.
- The previous receipt review rendered repeated identical purchase rows separately and exposed only discount type/value, with no affected-unit control.
- Review of migration 7 found that resolving every historical row before creating listings could fragment two equivalent historical tickets into separate variants. The backfill now chooses a deterministic representative for an unambiguous retailer/title group and regression coverage requires one shared variant/listing with separate immutable observations.
- Browser evidence review found that the initial six-column desktop editor allowed the derived total to wrap. The result/output is now explicitly non-wrapping and browser coverage asserts that behavior.

## Decision

1. A confirmed receipt line is confirmed product/price evidence and is projected into the existing global catalog model; no parallel receipt-product catalog is introduced.
2. Receipt evidence remains immutable. `receipt_items.original_description`, extraction JSON and corrections are never overwritten.
3. Matching is deterministic and conservative: reuse an existing variant for an exact retailer-title match first, then a unique exact variant-name match; otherwise create a new canonical product + variant using the confirmed receipt description.
4. When a retailer is known, preserve the receipt description as that retailer's listing title and create one immutable price observation for the receipt item using its confirmed unit price.
5. Receipt price evidence is idempotent by stable receipt-item identity so retries cannot duplicate observations.
6. `receipt_items.product_variant_id` links each confirmed line to the resolved global variant after projection.
7. Migration 7 backfills historical confirmed receipt rows and installs the `receipt_items_project_catalog` trigger. Future confirmed lines are projected transactionally by SQLite in the same receipt import transaction.
8. The catalog API exposes bounded latest confirmed prices per retailer/store for each listed variant; full historical evidence remains in `price_observations`.
9. The catalog UI is presented as a general product catalog, not only manually saved products. It shows ticket-derived variants, retailer-specific names and latest confirmed prices.
10. Existing parent grouping remains the explicit mechanism for combining semantically related variants under one canonical product when names differ; the system does not guess semantic equivalence.
11. Receipt normalization groups only truly equivalent purchase rows: normalized description, unit price and compatible tax/product attributes must match. Grouping preserves first-occurrence order, sums quantity and totals, merges source-line evidence and uses conservative confidence.
12. Duplicate physical rows of the same equivalent purchase are not considered an ownership ambiguity after grouping. A discount naming that unique aggregate may be assigned to that aggregate.
13. `ReceiptLineDiscount` gains an optional affected-unit `quantity`. Omission keeps the existing whole-line behavior for compatibility. The affected quantity must be a positive integer not exceeding the line quantity.
14. A percentage discount is calculated against `affected quantity × unit price`, with the existing integer basis-point half-up rounding. An amount discount remains a total monetary discount for the affected subset and cannot exceed that subset subtotal.
15. The AI contract explicitly scans the complete receipt, including promotion lines after an intermediate total, and reports the affected quantity when a discount applies to only some units. It must not mark repeated identical physical rows as ambiguous solely because they appeared more than once.
16. Basketra, not the AI, remains authoritative for arithmetic and grouping. AI output is locally validated and normalized before review.
17. Receipt review shows one row for an aggregated equivalent purchase and exposes `Affected units` only when a discount is active on a multi-unit line. This is a numeric bounded control rather than one UI row per physical unit.
18. The compact summary identifies partial discounts, for example `50% · 1 of 2 units`, and the backend calculation endpoint remains the single owner of the derived line total.
19. Truly ambiguous discounts remain reviewable rather than being guessed. A discount may auto-attach only when one aggregate product target and a valid affected quantity can be established from structured evidence.
20. No dependency is added. Existing catalog/listing/evidence/price tables remain the catalog source of truth, and final receipt persistence may continue storing the resulting monetary `discount_minor` while original structured extraction evidence preserves how that discount was interpreted.

## Acceptance

- A newly confirmed receipt with one line appears in `/api/v1/catalog` without separately saving a product.
- Re-importing the same receipt is idempotent and does not duplicate products, retailer listings or price observations.
- Two receipts from the same retailer with the same title reuse the same variant and add separate immutable price observations.
- Exact matching does not collapse ambiguous duplicate catalog variants.
- A receipt with retailer metadata creates/preserves the retailer-specific listing title and latest price in catalog output.
- A receipt without retailer metadata still creates/reuses the global product variant but does not invent a price observation without a retailer.
- Previously confirmed receipt rows with no `product_variant_id` are projected by migration and become visible in the catalog.
- Multiple equivalent historical receipt rows converge on one variant/listing while preserving one immutable observation per receipt item.
- Original receipt descriptions/extractions/corrections remain unchanged after reconciliation.
- Catalog list/detail UI shows latest price by retailer/store with EUR formatting and retains parent/retailer editing.
- Empty-state copy no longer claims only explicitly saved list products will appear.
- Search continues to match canonical name, variant, aliases and retailer names/titles.
- Existing manual/photo price confirmation behavior remains compatible.
- Two equivalent receipt rows with the same product identity and unit price render as one line with summed quantity rather than duplicated rows.
- `2 × 1.75 EUR` with a 50% discount affecting 1 unit yields an 0.88 EUR discount and a 2.62 EUR line total using backend integer arithmetic.
- Whole-line percentage/amount discounts without affected quantity retain their existing behavior.
- Affected discount quantity greater than the line quantity, zero, fractional or non-numeric is rejected.
- The Alcampo duplicate-coconut example resolves to one quantity-2 line with a one-unit 50% discount and no false duplicate-row ambiguity warning.
- AI instructions explicitly require looking for discounts/promotions across the whole receipt and returning affected quantity where supported by evidence.
- The line editor lets the user change discount type, value and affected units without manually splitting identical products into multiple lines.
- Updating affected units triggers the same stale-safe backend-derived total flow as quantity, unit price and discount value changes.
- Desktop and mobile editors do not overflow horizontally and derived monetary totals remain on one line.
- Truly unresolved discounts remain visible for manual review instead of silently modifying a product.
- No polling, dependency, destructive migration, merge, release or deploy is introduced.

## Checks

- [x] regression integration tests added for future receipt projection and idempotency
- [x] regression integration tests added for historical receipt migration, including multiple equivalent historical tickets
- [x] migration ownership contract test added
- [x] catalog API/store-price tests added
- [x] browser coverage added for ticket-derived catalog product and price rendering
- [x] unit coverage added for partial-unit amount/percentage arithmetic and strict quantity validation
- [x] AI schema/prompt regression added for duplicate aggregation and affected-unit discounts
- [x] extraction/normalization regression added for the Alcampo duplicate-coconut/50% example
- [x] browser coverage added for grouped repeated rows and affected-unit discount editing
- [x] `pnpm quality` via Pull Request Quality run `33564618043`
- [x] Browser E2E: 79/79 passed in run `33564618043`
- [x] Security, container smoke, linux/amd64 and linux/arm64 passed in run `33564618043`
- [x] CodeQL Advanced run `33564617909` passed
- [x] browser artifact `9822772907` is bound to functional head `486e5ba4aae86bb9be8539668a5282820bc3c170`, digest `sha256:ddb413b44c30e1814d7da5bb63e6b62884cc236a9221f5b0d8c1c2159fb43bc1`
- [x] Publish PR visual evidence run `33564617966` passed for the same functional head
- [x] desktop/mobile visual review completed for populated catalog, partial-unit discount editor, standard percentage editor, calculation error, genuine ambiguity, responsive editor and restored cancel state
- [x] final functional diff scope inspected; PR has no review threads at the functional validation head

## Visual review

- Catalog mobile: product card, retailer-specific title, latest Mercadona price, reusable ficha and parent/retailer controls are readable with no horizontal overflow.
- Partial discount mobile: one grouped quantity-2 row exposes `Unidades con descuento = 1`, `50%` and backend-derived total `2.62 EUR` without horizontal overflow.
- Partial discount desktop: six-column editor remains readable and `2.62 EUR` stays on one line after the nowrap regression fix.
- Standard percentage editor: `50%` and derived `0.87 EUR` remain readable on desktop and mobile.
- Calculation error: full error message spans the row and `Guardar línea` is visibly disabled while the stale total is not accepted as a valid calculation.
- Genuine ambiguity: two same-label products at different prices remain separate and the unassigned 50% warning is visible for manual review.
- Cancel race: dialog remains closed after the late response; the compact restored row shows `BEBIDA COCO`, `0.87 EUR` and `Dto. 50%`.

## Delivery

- Branch: `agent/fix-receipt-catalog-projection`
- Pull request: `#47`
- Functional validation head: `486e5ba4aae86bb9be8539668a5282820bc3c170`
- Merge/release/deploy: prohibited without explicit approval.
- Rollback: revert this PR. Receipt evidence is preserved because projection only adds/reuses catalog relations and immutable observations; receipt normalization changes review/import interpretation but never overwrites source extraction evidence.

## Status

Functional implementation and visual evidence are complete on `486e5ba4aae86bb9be8539668a5282820bc3c170`. Quality, Browser E2E, Security, both container architectures, container smoke, CodeQL and direct PR visual publication are green, and the relevant artifact screenshots have been manually reviewed. This documentation update is the final repository change; the resulting documentation head must be revalidated exactly before the PR is considered ready for human review. No merge, release or deployment has been performed.
