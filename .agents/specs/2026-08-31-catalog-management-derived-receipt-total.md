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
- Receipt review previously rendered `lineTotalEuro` as an editable field, which allowed UI state to drift from the arithmetic that the server later validates.
- Pull Request Quality run `33438526734` proved the synchronized derived-total implementation passes formatting, lint, TypeScript, unit/integration coverage, domain coverage, build, resource budgets, security, container smoke and both container architectures. Its Browser E2E run improved the earlier regression set from 65/70 to 67/70 and isolated the remaining failures to deterministic test navigation/synchronization rather than production arithmetic.
- Pull Request Quality run `33440283894` on head `a80342b2fcb5ca90c5cd85df81166454c328be5a` is fully green: Browser E2E, Quality, Security, container smoke, linux/amd64 and linux/arm64 all passed. CodeQL run `33440283866` also passed.
- The authoritative browser artifact `9776123439` belongs to head `a80342b2fcb5ca90c5cd85df81166454c328be5a` and has digest `sha256:c7c71b585a021d55094a45300bf5573fa046d24d9b4bc5478f9b1a2bf6fb8436`.
- Visual review of the stabilized catalog state at 390 px confirms the terminal retailer state (`Lidl` / `Leche fresca Milbona 1 L`), no horizontal overflow, no clipped form controls and a coherent single-column mobile workflow.
- The direct visual-evidence publisher previously exposed only a fixed set of historical critical screens, so the new catalog UI was absent from the PR comment despite existing in the authoritative browser artifact. The publisher now copies `catalog-mobile.png` as `13-catalog-management.png` and places it first in the PR evidence comment.
- Pull Request Quality run `33442290036` on delivery head `37e9702e0859b556c903ad7d8addd700e00bef97` passed Quality, Security, container smoke, linux/amd64 and linux/arm64, while CodeQL run `33442290090` passed both Actions and JavaScript/TypeScript analysis. Browser E2E passed 69/70; the only failure was the pre-existing PDF manual-recovery boundary test waiting up to five seconds for an incidental second job read that was not contractually guaranteed to occur on its own. Both catalog scenarios and all receipt-line validation scenarios passed on that run.
- The PDF recovery regression is now deterministic: a shared controlled `EventSource` helper emits the realtime `open` event explicitly to initiate the second job refresh, the mocked response remains gated while manual review is selected, and the late refresh is then released to prove it cannot overwrite manual state. No sleep, retry, polling workaround or production change is used.
- Pull Request Quality run `33443224911` on head `d35f279d027c4f4eed4f8ef5c36ffab13440205a` is fully green: all 70 Browser E2E scenarios passed, together with Quality, Security, container smoke, linux/amd64 and linux/arm64. CodeQL run `33443224883` passed both Actions and JavaScript/TypeScript analysis. Browser artifact `9777191300` belongs to the same head and has digest `sha256:1523375462cd5df26857908f5901629663db586bb742b52ad2e5312c9c935269`.
- Final review of that browser artifact found the runtime viewport correct but the `fullPage` evidence misleading: Playwright stitching repeated the sticky app header within the long image and exposed the skip link even though neither defect exists in the actual viewport. The evidence capture must therefore avoid page-level stitching rather than normalize those artifacts as product behavior.

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
- Render receipt line total as read-only. Quantity, unit price and discount changes trigger bounded, race-safe recalculation; stale requests are cancelled/ignored. The browser coordinates request lifecycle only and never duplicates the multiplication/subtraction rule.
- A pending derived calculation blocks Save line, per-line validation, whole-ticket validation and final confirmation until the latest calculation settles. A failed calculation leaves the action blocked and exposes the calculation error instead of allowing stale data to continue.
- Keep declared receipt total editable because it represents the amount printed on the receipt, not a derived line value.
- Publish the catalog's stabilized mobile screenshot in the direct PR visual evidence whenever this UI is part of a visual-impacting head, rather than relying on an artifact that reviewers must download manually.
- Browser tests that need realtime reconnection use one shared controlled `EventSource` helper. A boundary test must trigger the event that owns the transition rather than wait for incidental timing.
- Generate `catalog-mobile.png` from the `.catalog-view` element instead of a page-level `fullPage` screenshot. The catalog element is the evidence owner and excludes unrelated fixed/sticky shell controls that Playwright can duplicate while stitching long pages.

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
11. Save, validation and final confirmation cannot consume a stale line total while the latest derived calculation is pending or failed.
12. Existing receipt validation, discount corrections, cancel/revert, delete/undo and final confirmation behavior remain intact.
13. Mobile layout remains usable at narrow widths with keyboard-visible labels and no required hover interaction.
14. New API behavior has unit/integration coverage and the receipt editor has browser regression coverage.
15. Required GitHub checks are green on the final PR head before completion.
16. The direct PR visual-evidence comment includes the stabilized catalog-management mobile screenshot generated from the same validated head as Browser E2E, without page-stitching artifacts from unrelated shell controls.
17. The late durable-job recovery regression deterministically proves a realtime refresh cannot overwrite a manual-review transition without depending on scheduler timing or retrying a flaky test.

## Scope

Included:

- bounded catalog browse endpoint
- canonical parent create/link operations
- retailer-listing title upsert
- first-class catalog UI using existing visual primitives/tokens
- canonical backend receipt-line calculation
- read-only, live-derived receipt line total
- coordination that prevents stale derived totals from crossing save/validation/confirmation boundaries
- focused tests and documentation
- direct PR publication of the new catalog screenshot from the authoritative browser artifact
- deterministic shared browser-test control for receipt realtime reconnection
- element-scoped catalog evidence capture that avoids page stitching

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
- A failed live-calculation request keeps the previous value visible for context but blocks save/validation/confirmation until a later successful calculation replaces it; the stale value is therefore never accepted as the current derived result.
- Multiple browser tabs can edit catalog relationships concurrently. SQLite transactions make each write atomic; last completed relationship write wins. No new optimistic-version schema is introduced in this scope.
- Page-level full-page screenshots can reposition or duplicate sticky elements in stitched output. Catalog evidence must remain element-scoped so visual review evaluates the product surface rather than capture-engine artifacts.
- Receipt recovery depends on realtime invalidation rather than interval polling. Tests must explicitly model the realtime event when validating late refresh races; waiting for an unspecified reconnect creates nondeterminism without increasing production coverage.

## Tests

- domain unit tests for shared receipt-line calculation and validation
- catalog-management repository unit/integration tests against temporary SQLite data
- HTTP integration tests for catalog browse, parent create/link and retailer-specific name upsert
- browser tests proving total is read-only and follows quantity/price/discount changes without client arithmetic ownership
- browser regression tests proving save/validation waits for the current derived total and stale responses cannot overwrite a newer edit
- existing receipt validation browser regressions, including discount edit/cancel/validate/confirm flows
- browser evidence checks that wait for terminal catalog mutations before capturing the `.catalog-view` as `catalog-mobile.png`
- deterministic realtime recovery race coverage using `tests/browser/helpers/controlled-event-source.mjs`
- `pnpm quality` in authoritative Pull Request Quality CI
- CodeQL, security, amd64/arm64 container builds, hardened container smoke and visual evidence workflows

## Rollback

All API and UI changes are additive except making the receipt-line total read-only. Reverting the feature commits restores the prior UI/API behavior. No schema migration is required and no historical evidence is rewritten. The visual-evidence addition is independently reversible by removing the catalog capture from `.github/workflows/pr-visual-evidence.yml`. The deterministic browser helper and element-scoped screenshot change are test-only and have no runtime impact.

## Delivery

Use atomic Conventional Commits on `agent/feat-catalog-management-derived-total`, push the branch, open a non-draft PR, inspect all required CI and visual evidence, fix failures, and do not merge/release/deploy.

## Status

Implementation and production validation are complete. Head `d35f279d027c4f4eed4f8ef5c36ffab13440205a` passed the complete functional/security/container/CodeQL matrix with 70/70 Browser E2E scenarios, but FINAL REVIEW rejected its page-level `catalog-mobile.png` because Playwright stitching duplicated unrelated shell UI. Commit `7083995829aa2809895d8ccda5fcebf283088b54` replaces only that test evidence capture with an element-scoped `.catalog-view` screenshot; the resulting delivery head must pass the full matrix, publish `13-catalog-management.png` from the same SHA, and pass manual visual review before handoff.
