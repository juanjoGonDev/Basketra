# Receipt Store Product Projection

## Request

Enforce one concrete Store for every newly confirmed receipt and ensure every catalog/price projection derived from that receipt uses the same Store. Preserve the normalized Product-to-Store relationship through `canonical_products -> product_variants -> retailer_listings -> price_observations.store_id`; do not add a parallel relationship.

This task also requires safe historical repair, atomic Store reassignment through `PATCH /api/v1/inventory/tickets/:id`, and focused receipt-review UI wording/selection so confirmation cannot represent Store as optional.

## Evidence

### Verified repository facts

- `BasketraDatabase.importReceipt` in `src/infrastructure/database.ts` checks `receipts.import_key` for idempotency, starts `BEGIN IMMEDIATE`, resolves/creates the retailer, then resolves a supplied Store id or reuses/creates `storeName + retailerName`. The confirmed `receipts` row is inserted before any `receipt_items`, and the whole import commits or rolls back together.
- The same import currently initializes `storeId` to `null` and still inserts `status = 'confirmed'` when neither `storeId` nor `storeName` is supplied. Therefore the current application path permits a confirmed receipt with no Store.
- A supplied `storeId` is looked up and its retailer is checked against an already resolved retailer. A supplied Store name is reused case-insensitively for the resolved retailer or created inside the same receipt transaction.
- `src/receipts/import.ts` currently parses `retailerName`, `storeId`, and `storeName` as optional confirmation fields, so an API caller can reach `importReceipt` without any resolvable Store.
- `src/receipts/extraction.ts` and `src/receipts/result.ts` model Store identity as optional AI interpretation data. `assembleReceiptExtraction` carries a Store only when the page interpretations agree. This is proposal/evidence behavior and is not item-level ownership.
- `src/web/receipt-review.js` carries detected Store id/name into `POST /api/v1/receipts/confirm`, but confirmation does not require either field. `src/web/receipts.js` renders `Tienda detectada (opcional)` and a read-only Store field.
- Migration 7 in `src/infrastructure/collaboration-schema-core.ts` owns receipt catalog projection. For confirmed receipt lines it resolves/reuses or creates the canonical product and variant, assigns `receipt_items.product_variant_id`, resolves/reuses a retailer listing, creates receipt evidence with `source_type = 'receipt'` and `source_reference = 'receipt-item:' || receipt_item.id`, and inserts one observation per evidence according to its existing `NOT EXISTS` rule.
- Both the historical migration-7 INSERT and the runtime `receipt_items_project_catalog` trigger explicitly pass `NULL` as `price_observations.store_id`.
- Migration 12 in `src/infrastructure/inventory-schema.ts` creates `receipt_price_observation_assign_store`, an `AFTER INSERT ON price_observations` trigger keyed by the `price_receipt_<receipt_item_id>` id convention. It updates newly inserted receipt prices to the receipt Store only when the receipt already has a non-null Store. It does not backfill observations that existed before migration 12.
- Migration 13 performs the historical repair by joining `price_observations.evidence_id -> external_evidence`, requiring `source_type = 'receipt'` and `source_reference = 'receipt-item:' || receipt_items.id`, then joining that item to its receipt. It changes only observations whose `store_id IS NULL` and whose owning receipt has a non-null Store.
- The migration runner applies only versions greater than `MAX(schema_migrations.version)`, requires contiguous versions, takes a pre-migration backup, runs pending migrations in one immediate transaction, checks integrity/version, and rolls back on failure. Repository policy states applied migrations are not rewritten.
- The migration safety classifier currently treats `DROP TRIGGER` as destructive. Replacing the migration-7 runtime trigger by dropping/recreating it would therefore violate the normal safe-upgrade contract unless migration infrastructure semantics were broadened.
- Store read-model counts in `src/api/inventory-management-core.ts` remain normalized: tickets count distinct `receipts.id` joined by `receipts.store_id`; prices count distinct `price_observations.id` joined by `price_observations.store_id`; products count distinct `retailer_listings.product_variant_id` reachable from those Store-owned observations. No cached counters exist.
- `PATCH /api/v1/inventory/tickets/:id` in `src/api/inventory-ticket-management.ts` already uses one `BEGIN IMMEDIATE` transaction for line and receipt edits. However, a selected Store currently replaces the receipt retailer with the Store retailer instead of rejecting an incompatible Store, and the code updates `receipts.store_id` without retargeting receipt-derived `price_observations.store_id`.
- New manual lines added during ticket editing are inserted before the receipt metadata update, so the existing receipt projection trigger observes the old receipt Store during a Store-changing edit.
- `src/api/errors.ts` maps `RangeError`/validation errors to the existing 400 `VALIDATION_ERROR` contract, but the current `RECEIPT_STORE_*` string errors are not explicitly mapped and can otherwise become an unexpected 500.
- Existing tests cover receipt Store creation/reuse, Store/retailer mismatch at `importReceipt`, migration-13 repair, product count derived from repaired observations, catalog latest Store price, Store management, migration upgrades, and ticket evidence preservation. They do not yet cover all acceptance scenarios below.

### Assumptions

- Historical confirmed receipts that genuinely have no known Store cannot be assigned a fabricated Store during migration. The invariant is enforced for new confirmations and subsequent confirmed-ticket writes; legacy unknown Store rows remain historical debt until explicitly repaired with real Store evidence.
- Migration 12 remains installed for compatibility because applied migration objects are immutable. It must no longer be the primary mechanism that gives new receipt observations their Store.
- A legacy ticket with no retailer may adopt the retailer of a user-selected Store when explicitly repaired through the editor; when a retailer already exists, Store/retailer mismatch must be rejected.

## Root cause

The primary defect is not AI extraction. Store identity already flows from extraction to confirmation and `importReceipt` can resolve/create it.

The consistency failure is caused by two write-path gaps:

1. Confirmation does not require a Store, so a confirmed receipt can be persisted with `store_id = NULL`.
2. Migration 7's runtime projection inserts receipt-derived `price_observations` with `store_id = NULL`; migration 12 repairs only later in an AFTER INSERT trigger. Databases containing projections created before that trigger can retain null Store ownership, which is why a Store can report a ticket but zero products/prices.

Ticket editing has a related consistency gap: Store reassignment changes the receipt but not the evidence-proven observations, and it currently changes retailer ownership instead of validating compatibility.

## Domain invariant

For every newly confirmed receipt:

```text
receipt.store_id != NULL

receipt_item
  -> product_variant
  -> canonical_product

product_variant
  -> retailer_listing
  -> price_observation
       retailer_id = receipt.retailer_id
       store_id = receipt.store_id
       evidence.source_type = receipt
       evidence.source_reference = receipt-item:<receipt_item.id>
```

AI may propose receipt-level Store identity. Once the Store is resolved, every confirmed item is projected to that Store deterministically. Item-level AI Store assignment is forbidden.

## Decision

Use the smallest forward-compatible change:

1. Require a resolvable Store in receipt confirmation and keep Store resolution inside the existing `importReceipt` transaction before the receipt row and receipt-item projection.
2. Add a new safe forward migration rather than modifying migrations 7, 12, or 13.
3. The new migration will install a receipt-evidence-specific `BEFORE INSERT` guard/write trigger for `price_observations`. When legacy migration-7 projection attempts a receipt-derived observation with null Store, the trigger will prove receipt ownership through the canonical evidence relation, require a non-null receipt Store, insert the row with all original values but `store_id = receipts.store_id`, and ignore the original null insert. Therefore the persisted observation is born with Store ownership; migration 12 remains only a compatibility safety net.
4. Add forward guards preventing new confirmed receipt writes from introducing a null Store. Application validation remains the user-facing error owner.
5. Keep migration 13 as the historical backfill; do not widen it to ids, manual evidence, photo evidence, or unrelated observations.
6. Reorder the ticket-edit transaction so Store validation and receipt Store metadata are established before any newly inserted confirmed line can trigger catalog projection. Retarget only evidence-proven observations for that receipt in the same transaction.
7. Keep Store read models normalized and unchanged.
8. Make the receipt Store field required/editable in the focused review flow. AI may prefill it; manual input uses the existing backend Store reuse/create convention. Existing Store suggestions may reuse the current Inventory Store listing API, but no per-item Store UI is introduced.

## Migration strategy

- Migrations 7, 12, and 13 are immutable and remain unchanged.
- Migration 7 remains the historical/runtime catalog projection owner.
- Migration 12 remains installed because removing it would require rewriting applied migration history or dropping a trigger. Its role becomes compatibility fallback only.
- Migration 13 is sufficient for historical observations that can be proven by receipt evidence and whose receipt already has a Store. It is not superseded.
- The new forward migration changes no historical prices, evidence, products, variants, listings, or Store ids. It adds write guards only.
- Eligible migration-13 rows are exactly observations with `store_id IS NULL` where their `evidence_id` joins an `external_evidence` row with `source_type='receipt'` and `source_reference='receipt-item:' || receipt_items.id`, and that item joins a receipt with non-null `store_id`.
- Manual/photo/unrelated evidence cannot satisfy that predicate and is not modified.
- The migration runner executes each version once transactionally, so the forward migration is safe under existing execution guarantees.

## Acceptance criteria

- New ALCAMPO receipt with `retailerName=ALCAMPO`, `storeName=ALCAMPO ALMERIA`, multiple lines and no pre-existing Store creates/reuses exactly one Store.
- Every newly confirmed receipt has non-null `receipts.store_id`.
- Every confirmed line has `product_variant_id`; canonical products, variants and retailer listings follow existing reuse/idempotency rules.
- Every receipt-derived observation is persisted with the same Store as its receipt from its initial successful INSERT path.
- Reimporting the same logical receipt preserves current import-key idempotency and does not duplicate catalog/listing/observation data.
- Existing Store confirmation does not duplicate the Store and validates retailer compatibility.
- Missing Store confirmation fails explicitly and leaves no receipt/catalog/price partial writes.
- Incompatible Store/retailer confirmation fails explicitly and atomically.
- Migration 13 repairs only eligible historical receipt observations and leaves manual/photo/unrelated observations unchanged.
- Ticket Store reassignment validates Store existence and retailer compatibility, updates the receipt and every evidence-proven observation for that receipt in one transaction, and leaves unrelated observations untouched.
- A failed ticket Store edit leaves receipt and observations unchanged.
- Store detail for the ALCAMPO fixture reports `ticketCount = 1`, `productCount > 0`, and `priceObservationCount > 0`.
- Receipt review no longer labels Store optional and cannot confirm without a concrete Store name/id.
- No parallel Product-to-Store table, cache, queue, or asynchronous repair path is introduced.

## Tests/checks

Regression tests must cover:

1. New receipt + previously nonexistent ALCAMPO Store, multiple lines, full persisted relationship and Store read-model counts.
2. Existing Store reuse and retailer-listing reuse.
3. Import-key idempotent reconfirmation.
4. Real migration upgrade from a pre-13 state with receipt-owned null-Store observations.
5. Manual, product-photo, and unrelated evidence unchanged by historical backfill.
6. Ticket Store reassignment propagation by receipt evidence and transaction rollback.
7. Incompatible Store retailer rejected for confirmation and ticket editing.
8. Receipt without a resolvable Store rejected with no partial projection.
9. Browser confirmation flow requires Store and uses AI proposal/manual Store input without per-item Store logic.
10. Exact database proof of receipt -> item -> variant -> canonical product -> listing -> observation -> Store ids.

Required checks after implementation: focused integration tests, affected receipt/catalog/Store/schema/API tests, affected Playwright browser tests, `pnpm quality`, exact-head GitHub CI, and final visual/runtime review.

## Rollback

- Application-code rollback can restore the prior confirmation/editor behavior, but doing so would again permit the historical inconsistency and is not recommended while the new migration is present.
- The forward migration only adds defensive triggers; it does not delete or rewrite evidence or price history.
- Data already repaired by migration 13 remains valid historical data and must not be nulled or deleted during rollback.
- Migration 12 remains installed throughout rollback and can continue acting as a compatibility fallback for legacy projection behavior.
- Do not delete valid historical observations merely to reverse application behavior. A later forward migration is required if trigger policy ever needs to change.

## Delivery status

- Recon complete: yes
- Spec complete: yes
- Regression tests added: not yet for the expanded invariant
- Implementation complete: no
- Focused tests passing: not run for the expanded invariant
- Browser tests passing: no; exact head `8cc74577dc6b89e2e037a4ac239e61283a01c78e` has two unrelated layout regressions still to fix after this domain work
- `pnpm quality` passing: exact-head Quality job passed in CI, but must be rerun after new changes
- CI status: failing on Browser E2E at the pre-change head
- Ready for human review: no
