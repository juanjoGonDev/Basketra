# Receipt catalog projection

## Request

Confirmed ticket products must feed the global catalog automatically. The catalog must expose reusable canonical products/variants, retailer-specific names, and confirmed price observations by retailer/store so ticket analysis produces reusable shopping intelligence instead of an isolated receipt archive.

## Evidence

- `BasketraDatabase.importReceipt()` persisted `receipts`, `receipt_extractions`, `receipt_items` and corrections, but inserted receipt items without `product_variant_id`.
- `/api/v1/catalog` reads `product_variants`/`canonical_products`; therefore confirmed receipt items did not appear unless a product was independently saved elsewhere.
- `CatalogRepository.confirmPriceObservation()` already owns immutable price evidence for explicit/manual flows, while ticket confirmation had no projection into that model.
- The deployed catalog could consequently show zero saved products while confirmed receipts existed.
- Existing databases require a historical backfill as well as fixing future receipt confirmations.

## Decision

1. A confirmed receipt line is confirmed product/price evidence and is projected into the existing global catalog model; no parallel receipt-product catalog is introduced.
2. Receipt evidence remains immutable. `receipt_items.original_description`, extraction JSON and corrections are never overwritten.
3. Matching is deterministic and conservative: reuse an existing variant for an exact retailer-title match first, then a unique exact variant-name match; otherwise create a new canonical product + variant using the confirmed receipt description.
4. When a retailer is known, preserve the receipt description as that retailer's listing title and create one immutable price observation for the receipt item using its confirmed unit price.
5. Receipt price evidence is idempotent by stable receipt-item identity so retries cannot duplicate observations.
6. `receipt_items.product_variant_id` links each confirmed line to the resolved global variant after projection.
7. Migration 7 backfills historical confirmed receipt rows and installs the `receipt_items_project_catalog` trigger. Future confirmed lines are projected transactionally by SQLite in the same receipt import transaction.
8. The catalog API must expose bounded latest confirmed prices per retailer/store for each listed variant; full historical evidence remains in `price_observations`.
9. The catalog UI is presented as a general product catalog, not only manually saved products. It shows ticket-derived variants, retailer-specific names and latest confirmed prices.
10. Existing parent grouping remains the explicit mechanism for combining semantically related variants under one canonical product when names differ; the system does not guess semantic equivalence.
11. No dependency is added. The migration reuses existing catalog/listing/evidence/price tables and introduces no parallel product schema.

## Acceptance

- A newly confirmed receipt with one line appears in `/api/v1/catalog` without separately saving a product.
- Re-importing the same receipt is idempotent and does not duplicate products, retailer listings or price observations.
- Two receipts from the same retailer with the same title reuse the same variant and add separate immutable price observations.
- Exact matching does not collapse ambiguous duplicate variants.
- A receipt with retailer metadata creates/preserves the retailer-specific listing title and latest price in catalog output.
- A receipt without retailer metadata still creates/reuses the global product variant but does not invent a price observation without a retailer.
- Previously confirmed receipt rows with no `product_variant_id` are projected by migration and become visible in the catalog.
- Original receipt descriptions/extractions/corrections remain unchanged after reconciliation.
- Catalog list/detail UI shows latest price by retailer/store with EUR formatting and retains parent/retailer editing.
- Empty-state copy no longer claims only explicitly saved list products will appear.
- Search continues to match canonical name, variant, aliases and retailer names/titles.
- Existing manual/photo price confirmation behavior remains compatible.
- No polling, dependency, destructive migration, merge, release or deploy is introduced.

## Checks

- [x] regression integration tests added for future receipt projection and idempotency
- [x] regression integration test added for historical receipt migration
- [x] migration ownership contract test added
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

Root cause confirmed. Receipt projection and historical backfill are implemented with regression coverage; catalog price API/UI and full validation are pending.
