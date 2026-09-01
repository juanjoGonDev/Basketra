# Receipt catalog projection

## Request

Confirmed ticket products must feed the global catalog automatically. The catalog must expose reusable canonical products/variants, retailer-specific names, and confirmed price observations by retailer/store so ticket analysis produces reusable shopping intelligence instead of an isolated receipt archive.

## Evidence

- `BasketraDatabase.importReceipt()` currently persists `receipts`, `receipt_extractions`, `receipt_items` and corrections, but inserts receipt items without `product_variant_id`.
- `/api/v1/catalog` reads `product_variants`/`canonical_products`; therefore confirmed receipt items do not appear unless a product was independently saved elsewhere.
- `CatalogRepository.confirmPriceObservation()` already owns immutable price evidence, retailer/listing creation, exact money normalization and optional store linkage, but receipt import does not call it.
- The deployed catalog can consequently show zero saved products while confirmed receipts exist.
- Existing databases require reconciliation as well as fixing future receipt confirmations.

## Decision

1. A confirmed receipt line is confirmed product/price evidence and is projected into the existing global catalog model; no parallel receipt-product catalog is introduced.
2. Receipt evidence remains immutable. `receipt_items.original_description`, extraction JSON and corrections are never overwritten.
3. Matching is deterministic and conservative: reuse an existing variant for an exact retailer-title match first, then a unique confirmed alias/name match; otherwise create a new canonical product + variant using the confirmed receipt description.
4. When a retailer is known, preserve the receipt description as that retailer's listing title and create one immutable price observation for the receipt item using its confirmed unit price.
5. Receipt price evidence is idempotent by a stable receipt-item source reference so retries/startup reconciliation cannot duplicate observations.
6. `receipt_items.product_variant_id` links each confirmed line to the resolved global variant after projection.
7. Existing confirmed receipt lines are reconciled at startup in bounded work. Future imports reconcile the newly confirmed receipt immediately and retries repair incomplete projection.
8. The catalog API exposes bounded latest confirmed prices per retailer/store for each listed variant; full historical evidence remains in `price_observations`.
9. The catalog UI is presented as a general product catalog, not only manually saved products. It shows ticket-derived variants, retailer-specific names and latest confirmed prices.
10. Existing parent grouping remains the explicit mechanism for combining semantically related variants under one canonical product when names differ; the system does not guess semantic equivalence.
11. No database migration or dependency is required because the existing schema already has `product_variant_id`, retailer listings, evidence and price observations.

## Acceptance

- A newly confirmed receipt with one line appears in `/api/v1/catalog` without separately saving a product.
- Re-importing the same receipt is idempotent and does not duplicate products, retailer listings or price observations.
- Two receipts from the same retailer with the same normalized title reuse the same variant and add separate immutable price observations.
- Exact matching does not collapse ambiguous duplicate variants.
- A receipt with retailer metadata creates/preserves the retailer-specific listing title and latest price in catalog output.
- A receipt without retailer metadata still creates/reuses the global product variant but does not invent a price observation without a retailer.
- Previously confirmed receipt rows with no `product_variant_id` are projected on startup and become visible in the catalog.
- Original receipt descriptions/extractions/corrections remain unchanged after reconciliation.
- Catalog list/detail UI shows latest price by retailer/store with EUR formatting and retains parent/retailer editing.
- Empty-state copy no longer claims only explicitly saved list products will appear.
- Search continues to match canonical name, variant, aliases and retailer names/titles.
- Existing manual/photo price confirmation behavior remains compatible.
- No polling, dependency, destructive migration, merge, release or deploy is introduced.

## Checks

- [ ] regression integration tests for future receipt projection and idempotency
- [ ] regression integration test for startup reconciliation of historical receipts
- [ ] catalog API test for latest retailer/store prices
- [ ] browser test for ticket-derived catalog product and price rendering
- [ ] `pnpm quality`
- [ ] Browser E2E
- [ ] security/container/CodeQL CI
- [ ] desktop/mobile visual review of populated catalog
- [ ] final diff/PR/review-thread inspection

## Delivery

- Branch: `agent/fix-receipt-catalog-projection`
- Pull request: pending
- Merge/release/deploy: prohibited without explicit approval.
- Rollback: revert this PR. Receipt evidence is preserved because projection only adds/reuses catalog relations and immutable price observations.

## Status

Root cause confirmed. Implementation and regression coverage are pending.
