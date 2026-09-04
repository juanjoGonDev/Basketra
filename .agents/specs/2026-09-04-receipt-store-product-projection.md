# Receipt Store Product Projection

## Request

Enforce one concrete Store for every confirmed receipt and ensure every catalog/price projection derived from that receipt uses that exact Store. Preserve the normalized Product-to-Store relationship through `canonical_products -> product_variants -> retailer_listings -> price_observations.store_id`; do not add a parallel relationship.

The scope also includes safe historical repair, atomic Store reassignment through `PATCH /api/v1/inventory/tickets/:id`, and focused receipt-review UI behavior so confirmation cannot represent Store as optional.

## Evidence

### Verified repository facts before the fix

- `BasketraDatabase.importReceipt` owns receipt persistence and import-key idempotency inside `BEGIN IMMEDIATE` / `COMMIT` with rollback on failure.
- Store resolution already existed there: a supplied `storeId` is resolved and retailer compatibility is checked; `storeName + retailerName` reuses a case-insensitive match or creates one Store in the same transaction.
- Before this change, the import path could still confirm without resolving a Store.
- Migration 7 in `src/infrastructure/collaboration-schema-core.ts` owns receipt catalog projection. It resolves/reuses or creates canonical products and variants, assigns `receipt_items.product_variant_id`, resolves/reuses retailer listings, writes receipt evidence as `source_type='receipt'` and `source_reference='receipt-item:' || receipt_items.id`, and creates one price observation per evidence according to its existing idempotency rule.
- Both migration 7's historical projection and its runtime `receipt_items_project_catalog` trigger explicitly insert receipt-derived `price_observations.store_id` as `NULL`.
- Migration 12 in `src/infrastructure/inventory-schema.ts` creates `receipt_price_observation_assign_store`, an `AFTER INSERT` compatibility trigger keyed by the legacy `price_receipt_<receipt_item_id>` convention. It can repair a newly inserted receipt price after insertion when the receipt already has a Store, but it does not repair rows that predate the trigger.
- Migration 13 is the historical backfill. It proves receipt ownership through `price_observations.evidence_id -> external_evidence`, requiring `source_type='receipt'` and `source_reference='receipt-item:' || receipt_items.id`, then joins the item to its receipt. Only `price_observations.store_id IS NULL` rows with a non-null receipt Store are eligible.
- The migration runner applies only versions greater than the recorded schema version, requires contiguous versions, takes a pre-migration backup, executes pending migrations transactionally, verifies integrity/version, and rolls back on failure. Applied migrations are treated as immutable. The safety classifier treats `DROP TRIGGER` as destructive.
- Store read-model counts remain normalized in `src/api/inventory-management-core.ts`: tickets derive from `receipts.store_id`, prices from `price_observations.store_id`, and products from distinct retailer-listing variants reachable through those Store-owned price observations. No counter cache or Product-to-Store table exists.
- Before the ticket edit fix, `PATCH /api/v1/inventory/tickets/:id` changed `receipts.store_id` without moving receipt-evidenced observations and could adopt an incompatible Store retailer. Newly inserted lines could also project before the new Store metadata was established.
- Before the UI fix, the receipt review represented detected Store as optional/read-only and only submitted Store data supplied by AI detection.

### Verified current implementation

- `BasketraDatabase.importReceipt` now rejects unresolved Store with `RECEIPT_STORE_REQUIRED` before inserting the confirmed receipt or any receipt items. The resolved `receipts.store_id` is persisted before item projection, inside the existing receipt transaction.
- `src/api/errors.ts` maps all receipt Store validation failures to the existing 400 `VALIDATION_ERROR` contract.
- Forward migration 14 adds `receipt_price_observation_write_store`, a receipt-evidence-specific `BEFORE INSERT` trigger. When legacy migration 7 attempts to insert a receipt-derived observation with null Store, migration 14 proves the owning receipt through evidence, requires a non-null receipt Store, writes the observation with `store_id = receipts.store_id`, and ignores the original null insert. The persisted row is therefore born Store-owned rather than relying on migration 12's later update.
- Migration 14 also adds confirmed-receipt insert/update guards preventing `status='confirmed'` with null Store at the database boundary.
- Migrations 7, 12, and 13 remain unchanged. Migration 12 remains installed as a compatibility fallback; it is no longer the primary normal write path. Migration 13 remains the historical repair owner and is not superseded.
- `PATCH /api/v1/inventory/tickets/:id` now validates the target Store, rejects retailer mismatch, updates receipt Store metadata before inserting new confirmed lines, and retargets only observations whose evidence is proven to originate from receipt items of that receipt. All mutations occur in the same `BEGIN IMMEDIATE` transaction and roll back together.
- Receipt review now requires both Commerce and Store fields, allows Store input rather than read-only AI ownership, loads existing Store names from the existing Inventory Store endpoint, preserves AI prefill, and blocks confirmation before the API call when no Store can be resolved from the user-visible field.
- No item-level Store selector or AI item ownership was introduced.

### Assumptions

- Historical confirmed receipts that genuinely have no known Store cannot be assigned a fabricated Store during migration. The invariant is enforced for new confirmations and subsequent confirmed-ticket writes; legacy unknown-Store receipts require real Store evidence before manual repair.
- A legacy receipt with no retailer may adopt the retailer of an explicitly selected Store during repair; once a receipt already has a retailer, incompatible Store ownership is rejected.

## Root cause

The primary failure was not AI extraction. AI already proposed receipt-level Store identity and the backend could resolve/create a Store.

The real write-path defects were:

1. confirmation could persist a confirmed receipt without a Store;
2. migration 7's canonical receipt projection inserted receipt-derived observations with `store_id = NULL`, while migration 12 only repaired them after insertion and did not backfill older rows;
3. ticket Store editing changed the receipt without synchronously retargeting evidence-proven receipt observations;
4. the review UI still presented Store as optional and could not resolve it manually.

The historical symptom `Tickets = 1, Products = 0, Prices = 0` occurs because Store product/price counts are correctly derived from `price_observations.store_id`, so a receipt may be attached to a Store while its older observations remain unowned.

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

AI may propose receipt-level Store identity. Once Store is resolved, every confirmed item is projected to that Store deterministically. Item-level Store assignment is forbidden.

## Decision

1. Keep Store resolution in the existing `importReceipt` transaction and require it before receipt/item persistence.
2. Preserve migrations 7, 12, and 13 as immutable history.
3. Add migration 14 as the smallest forward-safe write-boundary correction instead of dropping/recreating migration-7 or migration-12 triggers.
4. Keep migration 12 only as compatibility fallback.
5. Keep migration 13 as the evidence-scoped historical backfill.
6. Keep Store counts normalized and derived; add no parallel relationship or cached counters.
7. Make ticket Store reassignment synchronous and atomic with evidence-proven observation reassignment.
8. Make receipt Store a required receipt-level UI decision while preserving AI proposal and existing Store reuse/create behavior.

## Migration strategy

- Migration 7 remains the immutable catalog projection owner.
- Migration 12 remains installed because removing/replacing an applied trigger would rewrite migration history or require a destructive `DROP TRIGGER`; its role is compatibility fallback only.
- Migration 13 remains sufficient for historical receipt-derived observations whose ownership can be proven and whose receipt already has a Store.
- Migration 14 is forward-only and safe: it adds write guards/triggers without deleting or rewriting products, variants, listings, evidence, receipts, or historical observations.
- Historical migration-13 eligibility is exactly: `price_observations.store_id IS NULL`, evidence joins `external_evidence`, evidence is `source_type='receipt'`, `source_reference='receipt-item:' || receipt_items.id`, and that item belongs to a receipt with non-null `store_id`.
- Manual, photo and unrelated evidence do not satisfy that predicate and are untouched.
- Migration execution is once-per-version and transactional under the existing runner.

## Acceptance criteria

- A new ALCAMPO receipt with `retailerName=ALCAMPO`, `storeName=ALCAMPO ALMERIA`, multiple lines and no pre-existing Store creates/reuses exactly one appropriate Store.
- Every newly confirmed receipt has non-null `receipts.store_id`.
- Every confirmed line has `product_variant_id`; canonical products, variants and retailer listings follow existing reuse/idempotency rules.
- Every receipt-derived observation is persisted with the same Store as its receipt from its initial successful insertion path; migration 12 is not required for the normal path.
- Existing Store confirmation does not duplicate the Store and validates retailer compatibility.
- Reimporting the same logical receipt preserves import-key idempotency without duplicate projection data.
- Missing or incompatible Store confirmation fails explicitly and atomically.
- Migration 13 repairs only eligible historical receipt observations and leaves manual/photo/unrelated observations unchanged.
- Ticket Store reassignment validates Store existence/retailer, moves the receipt and all evidence-proven receipt observations in one transaction, and leaves unrelated observations untouched.
- Failed ticket Store editing leaves receipt and observations unchanged.
- Store detail for the ALCAMPO fixture returns `ticketCount = 1`, `productCount > 0`, and `priceObservationCount > 0`.
- Receipt review no longer calls Store optional and cannot confirm without a concrete Store name/id.
- No `product_store`, equivalent duplicate relationship, cache, queue, or asynchronous repair path is introduced.

## Tests/checks

Regression coverage includes:

1. new receipt plus previously nonexistent ALCAMPO Store, multiple lines, full projection and Store counts;
2. existing Store reuse and retailer/listing reuse;
3. import-key idempotent reimport;
4. real schema upgrade from historical null-Store receipt prices;
5. manual/photo observations unchanged by backfill;
6. ticket Store reassignment and evidence scoping;
7. incompatible Store retailer rollback for confirmation/editing;
8. missing Store confirmation rollback;
9. required/editable receipt Store UI contract and browser confirmation flow;
10. dedicated database-proof fixture emitting the actual receipt/item/product/listing/observation/Store ids from the executed fixture.

Required checks before delivery: focused receipt/catalog/Store/schema/API tests, affected Playwright tests, `pnpm quality`, exact-head GitHub CI, database-proof log inspection, and final runtime/visual review.

## Rollback

- Application-code rollback can restore prior behavior, but doing so would re-open the consistency defect and is not safe while accepting new confirmed receipts.
- Migration 14 is additive and does not delete or rewrite historical evidence. If its policy must change later, use another forward migration rather than rewriting applied migration 14.
- Rows already repaired by migration 13 remain valid historical data and must not be nulled or deleted during rollback.
- Migration 12 remains installed throughout and continues to serve as a compatibility fallback.
- Do not delete valid observations merely to reverse application behavior.

## Delivery status

- Recon complete: yes
- Spec complete: yes
- Regression tests added: yes
- Implementation complete: yes
- Focused tests passing: pending exact-head CI execution
- Browser tests passing: pending exact-head CI execution
- `pnpm quality` passing: pending exact-head CI execution
- CI status: pending on the current implementation head
- Database proof: fixture added; actual IDs pending extraction from exact-head CI logs
- Ready for human review: no
