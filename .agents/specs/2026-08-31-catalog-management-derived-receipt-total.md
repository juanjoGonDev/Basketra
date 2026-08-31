# Catalog Management and Derived Receipt Line Total

## Request

Expose the reusable product catalog as a first-class workflow so a user can see saved products, edit their reusable metadata, relate variants under a shared canonical parent, create a new parent for an existing variant, and record the retailer-specific name used for that product. In receipt review, the line total must become derived and non-editable: changing quantity, unit price, or discount recalculates the line total from the canonical backend arithmetic immediately enough for interactive editing.

## Evidence

- `canonical_products` and `product_variants` already model the global parent/variant relationship.
- `retailer_listings` already owns the retailer-specific title for a product variant and is therefore the correct source of truth for “this product is called X in retailer Y”; adding a second retailer-aware alias model would duplicate that concept.
- `product_aliases` are global search aliases and currently have no retailer identity.
- The existing product editor is only reachable from a shopping-list item. There is no product collection endpoint or catalog screen for browsing saved reusable products.
- `receipt_items.original_description` is persisted evidence. It must remain immutable when catalog relationships are edited.
- `src/domain/receipt.ts::validateReceiptLine()` currently owns `quantity * unitPriceMinor - discountMinor` arithmetic.
- Receipt review currently renders `lineTotalEuro` as an editable field, which lets UI state drift from the arithmetic that the server later validates.

## Decision

- Reuse `canonical_products` as the parent item and `product_variants` as related variants. Do not introduce a new parent table.
- Reuse `retailer_listings.title` plus `retailers` for retailer-specific names. “Tienda” in this catalog relationship means retailer/commercial chain; physical branches remain `stores` and continue to belong to price observations.
- Add bounded catalog-management reads and relationship writes without modifying immutable receipt extraction/evidence or historical price observations.
- Creating a parent is an explicit operation on an existing variant: create the canonical parent and attach that variant atomically. Relating to an existing parent only changes the variant’s canonical-product foreign key.
- Do not delete the previous canonical product automatically when moving its last variant. Destructive cleanup is outside scope.
- Existing product metadata editing continues through the canonical `PATCH /api/v1/products/:variantId` endpoint.
- Add a first-class `Catálogo` view reachable from Home. Mobile uses one vertical flow; wider screens may present list and editor side by side without changing the workflow.
- The catalog editor explains that canonical name/category/description are shared by every variant related to the same parent.
- Add a backend receipt-line calculation operation whose domain implementation is the single arithmetic owner. `validateReceiptLine()` consumes the same calculation function.
- Render receipt line total as read-only. Quantity, unit price and discount changes trigger bounded, race-safe recalculation; stale requests are cancelled/ignored. Validation and final import remain server-authoritative.
- Keep declared receipt total editable because it represents the amount printed on the receipt, not a derived line value.

## Acceptance

1. Home exposes a discoverable Catalog action and the catalog view can be deep-linked with `#catalog`.
2. The catalog view lists persisted product variants with canonical parent, category and retailer-specific names, with a bounded server-side result limit.
3. Selecting a product exposes its existing editable metadata and saves through the established product PATCH endpoint.
4. A variant can be related to an existing canonical parent; the relationship persists and appears after reload.
5. A new canonical parent can be created and attached to the selected variant atomically.
6. A retailer-specific name can be added or edited for a variant by retailer name without creating a second retailer identity when a case-insensitive match exists.
7. Relationship operations do not alter receipt original descriptions, extraction payloads, price observations or evidence rows.
8. Receipt-line `Total (€)` is read-only in both inline and sheet editing.
9. Changing quantity, unit price or discount recalculates line total using backend domain arithmetic; the browser does not implement the multiplication/subtraction rule.
10. Calculation requests cancel/ignore stale results and do not create request storms.
11. Existing receipt validation, discount corrections, cancel/revert, delete/undo and final confirmation behavior remain intact.
12. Mobile layout remains usable at narrow widths with keyboard-visible labels and no required hover interaction.
13. New API behavior has unit/integration coverage and the receipt editor has browser regression coverage.
14. Required GitHub checks are green on the final PR head before completion.

## Scope

Included:

- bounded catalog browse endpoint
- canonical parent create/link operations
- retailer-listing title upsert
- first-class catalog UI using existing visual primitives/tokens
- canonical backend receipt-line calculation
- read-only, live-derived receipt line total
- focused tests and documentation

Excluded:

- deleting products, parents, retailer listings or historical evidence
- rewriting imported receipt evidence
- changing historical price observations
- physical-branch-specific product aliases
- bulk merge/deduplication automation
- new UI/component dependencies or a new state-management system

## Risks

- Moving a variant changes which canonical metadata it shares with related variants. The UI must make that consequence explicit before saving.
- Existing canonical parents with zero variants can remain after moves. They are retained rather than deleted because automatic data cleanup would be destructive.
- A failed live-calculation request can temporarily leave the previous derived total visible; subsequent driver edits retry, and final canonical validation still blocks invalid import.
- Multiple browser tabs can edit catalog relationships concurrently. SQLite transactions make each write atomic; last completed relationship write wins. No new optimistic-version schema is introduced in this scope.

## Tests

- domain unit tests for shared receipt-line calculation and validation
- catalog-management repository unit/integration tests against temporary SQLite data
- HTTP integration tests for catalog browse, parent create/link and retailer-specific name upsert
- browser tests proving total is read-only and follows quantity/price/discount changes without client arithmetic ownership
- existing receipt validation browser regressions
- `pnpm quality` when an executable local clone is available
- authoritative Pull Request Quality, CodeQL and visual evidence workflows

## Rollback

All API and UI changes are additive except making the receipt-line total read-only. Reverting the feature commits restores the prior UI/API behavior. No schema migration is required and no historical evidence is rewritten.

## Delivery

Use atomic Conventional Commits on `agent/feat-catalog-management-derived-total`, push the branch, open a non-draft PR, inspect all required CI and visual evidence, fix failures, and do not merge/release/deploy.

## Status

Specified; implementation in progress.
