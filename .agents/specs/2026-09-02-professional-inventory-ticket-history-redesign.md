# Professional Inventory and Ticket History Redesign

## Request

Replace the complete `Planes` destination with a professional `Inventario` module in exactly the same primary-navigation position. `Inventario` becomes the management hub for Products, Categories, Stores and Statistics. Redesign product/category/store management around paginated searchable/filterable lists and dedicated entity detail/edit/create views instead of rendering an entire inventory and editor in a single permanent view. Extend Tickets with a searchable historical list and a full invoice-style ticket detail/editor.

The six visual references under `.agents/specs/assets/2026-09-02-professional-inventory/` are normative baselines. The final affected views must match them with pixel-level visual parity: no intentional differences in layout hierarchy, spacing, component placement, action order, information architecture, color semantics, responsive task order or destructive-warning treatment. Real data, text lengths and viewport-specific reflow are naturally variable. Existing unrelated Basketra destinations must not be invented merely because a concept board includes contextual shell labels; the explicit product requirement is that `Inventario` occupies the current `Planes` slot.

`assets/2026-09-02-professional-inventory/visual-reference.json` contains the structured decomposition of every reference. Implementers and reviewers must read the PNG and its matching JSON entry together. JSON is the searchable/accessibility decomposition; the PNG is the visual authority when wording is ambiguous.

## Visual references

1. `assets/2026-09-02-professional-inventory/01-inventory-overview.png` — `inventory-overview` — Inventory hub replacing Plans.
2. `assets/2026-09-02-professional-inventory/02-product-list.png` — `product-list` — paginated/filterable product catalog with mobile swipe and desktop preview.
3. `assets/2026-09-02-professional-inventory/03-product-detail-editor-delete.png` — `product-detail` — dedicated product detail/edit/delete-impact states.
4. `assets/2026-09-02-professional-inventory/04-category-management.png` — `category-management` — paginated hierarchy, category detail, new-category form and dependency-aware deletion.
5. `assets/2026-09-02-professional-inventory/05-stores-statistics.png` — `stores-statistics` — store CRUD/detail/delete-impact flows and inventory analytics.
6. `assets/2026-09-02-professional-inventory/06-ticket-history-editor.png` — `ticket-history-editor` — ticket history, invoice-style ticket editor, line editor and destructive confirmation.

## Product requirements

### Primary navigation and Inventory hub

1. Remove the complete `Planes` section/destination from the user-facing application.
2. Put `Inventario` in the exact primary-navigation position currently occupied by `Planes`; do not append it elsewhere as an additional destination.
3. `Inventario` contains four first-class subsections: Products, Categories, Stores and Statistics.
4. The Inventory overview shows useful metrics, search/filter entry points and direct navigation into all four subsections, following reference 01.
5. The hub and every subsection are mobile-first and preserve the reference task order when reflowing.

### Shared professional inventory list behavior

1. Product, Category and Store collections are dedicated list views, not permanently combined with a full editor.
2. Lists support server-backed pagination, search, filters and deterministic sorting.
3. Filters are relevant to the entity, composable, visibly active and resettable.
4. Desktop follows the professional table/list density in the references and may open a transient contextual preview without replacing the dedicated detail route.
5. Mobile uses compact cards and the existing progressive swipe language: a short left swipe reveals Edit/Delete; destructive threshold behavior must preserve the existing undo/confirmation rules where applicable.
6. All swipe actions have pointer, keyboard and assistive-technology equivalents.
7. Loading, empty, error, no-results and permission/recovery states must be designed for every list.
8. Search/filter requests cancel or ignore stale responses and never reorder the user's currently visible results with an obsolete response.

### Products

1. Products have a paginated list with search by canonical name/SKU/barcode and filters including category, parent-category/hierarchy, store availability and stock state when that data exists canonically.
2. Product list rows/cards expose enough context for decisions without rendering the whole editor: identity, hierarchy, store count, recent price, stock state and updated time.
3. Product detail is a dedicated view showing identity, category and parent-category navigation, linked stores, recent price history, recent ticket usage and notes/metadata.
4. Product editing is a dedicated editor/sheet reachable from list/detail and follows the reference field hierarchy.
5. Product deletion always runs a server-side preflight immediately before destructive commit and presents current dependency counts, including ticket usage, linked inventory/store records and price history.
6. Deletion must never silently destroy immutable receipt evidence or price observations. If a hard delete would violate historical invariants, block it or use an explicit safe archival/tombstone strategy owned by the domain; do not cascade evidence away for convenience.
7. Parent-category navigation is visually separated from the product's own detail/edit form.
8. Product mobile rows support progressive swipe Edit/Delete with equivalent buttons/menu actions.

### Categories

1. Categories have a paginated searchable/filterable list while still visualizing arbitrary-depth hierarchy.
2. Category rows show name, color, direct product count, subcategory count, parent and status; hierarchy is represented with expansion/indentation rather than rendering the entire tree permanently.
3. Category detail is separate from list and shows general metadata, its exact location in the hierarchy, direct/derived counts and technical identity.
4. A dedicated New Category view/form supports name, parent, color and description plus a live hierarchy preview.
5. Editing may change name, parent, color and description through the validated category domain boundaries; cycles remain impossible.
6. Deletion preflight shows direct product count, subcategory count and descendant-with-products impact before confirmation.
7. `category_unknown` / `desconocido` remains protected from destructive rename/reparent/delete behavior defined by the category domain.
8. Deleting a category cannot orphan products silently. The API must require an explicit safe resolution such as reassignment to another valid category or fallback according to the canonical domain rule.
9. Category mobile rows support the same progressive swipe Edit/Delete language with accessible equivalents.

### Stores

1. Stores become a first-class Inventory subsection with list, detail, create, edit and delete flows matching reference 05.
2. Store list supports pagination, search, filters, deterministic sort and state indicators.
3. Store detail separates general information, linked products/inventory and recent activity/tickets.
4. Store create/edit manages canonical store metadata supported by the data model; do not invent unavailable address/geo fields without a schema decision.
5. Store deletion always runs a dependency preflight showing linked product/listing/inventory usage and historical ticket usage.
6. Historical price/ticket evidence must not be destroyed by deleting a store. Block, archive or explicitly reassign according to domain invariants.
7. Stores have the same loading/empty/error/responsive/accessibility standards as Products and Categories.

### Inventory statistics

1. Statistics is a first-class Inventory subsection, not a separate primary-navigation destination.
2. Provide a date/period selector and useful KPIs derived from canonical persisted data, including inventory/product/category/store/ticket metrics that are actually computable.
3. Reference 05 defines the target visual system: KPI cards, category distribution, store activity, ticket evolution and secondary actionable metrics.
4. Every chart has an accessible text/table equivalent and must not be the only representation of information.
5. No metric is recomputed independently in multiple layers: define canonical server-side queries/calculations and consume their results in the UI.
6. Statistics loading and aggregation must stay bounded for Raspberry Pi deployment; add indexes/queries based on measured plans rather than unbounded client aggregation.

### Ticket history

1. The Tickets destination gains a dedicated historical list for confirmed/imported tickets.
2. History supports pagination, search and filters for date range, store and category when supported by canonical relationships, plus deterministic sorting.
3. History shows summary metrics for the active filter period: ticket count, total spent, total line/items and average ticket derived server-side.
4. Desktop follows reference 06 table hierarchy; mobile uses ticket cards and progressive swipe Edit/Delete with accessible equivalents.
5. A ticket row opens a dedicated ticket detail/editor rather than editing historical data inline in the list.

### Historical ticket editor

1. The ticket editor follows the existing invoice visual language: ticket metadata at top, backend-derived totals, item table/list, notes and clear final actions.
2. Editable ticket metadata includes date/time and canonical store/retailer relationship where the current model safely supports it.
3. Ticket lines can be added, edited and removed through the existing canonical line-validation/calculation boundaries.
4. Line editing uses the same invoice-style component language already used for receipt-line editing; do not duplicate monetary/discount calculations in the browser.
5. Editing historical tickets must preserve original receipt captures, extraction and correction evidence. Changes create/update canonical correction/current-state records without rewriting source evidence.
6. Ticket total is backend-derived from canonical lines and cannot become an independent editable source of truth. If the reference appears to show an editable total, implementation must preserve the invariant and visually present the derived result.
7. Ticket date edits are validated and persisted explicitly; UTC/storage semantics and `es-ES` presentation remain consistent.
8. Ticket deletion always requires explicit confirmation with identity/date/store/total/item count and a server-side impact/preflight check immediately before commit.
9. Hard deletion is forbidden if it would destroy immutable evidence required by existing product/price/history invariants. Use a safe domain deletion/archive strategy instead of cascade-by-default.
10. The editor provides loading/error/conflict/recovery states and prevents duplicate submit/races.

## Visual parity contract

1. The six committed PNG files are approved visual baselines and permanent task artifacts.
2. Final implementation must target pixel-level parity for the affected views. "Close", "inspired by", alternate layouts and materially different spacing are not acceptable.
3. The PNG is authoritative for visual hierarchy and placement; `visual-reference.json` is authoritative for searchable semantic decomposition.
4. Components represented consistently across boards must be implemented as reusable primitives/feature components rather than copied markup.
5. Existing Basketra design tokens, icons and platform shell are reused where they correspond to the reference. If a concept image contains incidental shell destinations not requested by the product requirements, do not invent those destinations.
6. Mobile and desktop screenshots must be captured at the reference viewport sizes where declared and compared during final review.
7. Any intentional divergence from a reference because of accessibility, real-domain invariants or unavailable data must be the minimum necessary, documented in this spec with evidence, and require explicit user approval if visually material.
8. Do not modify, regenerate, optimize, crop, recompress or replace the six approved PNG files without explicit user approval.

## Data and deletion safety

1. Delete UI warnings are backed by fresh server-side dependency queries, not client estimates.
2. Confirmation and commit must revalidate dependencies transactionally to close TOCTOU races.
3. Destructive actions use stable error codes and actionable UI when dependencies changed after preflight.
4. Receipt captures, original extraction, corrections and immutable price observations retain their existing preservation rules.
5. Category/product/store deletion strategy must be explicit in domain/API tests; never rely on broad SQLite cascades to decide product semantics.
6. All destructive UI has accessible confirmation and recovery/undo where domain semantics make undo safe.

## API and persistence requirements

1. Add bounded query endpoints/contracts for Products, Categories, Stores and Ticket history instead of shipping full collections to the browser for client pagination.
2. Pagination uses deterministic stable ordering and a documented page-size maximum.
3. Search/filter inputs are runtime-validated as untrusted data.
4. Detail endpoints expose only canonical/derived fields required by their screens.
5. Dependency-preflight endpoints return typed counts/reasons and a version/token or equivalent mechanism when useful for transactional revalidation.
6. Statistics are computed server-side from canonical owners and tested once; client charts consume the returned series/KPIs.
7. Any schema migration is additive; do not rewrite migrations v1-v10. Migration v8 belongs to persisted runtime settings, v9/v10 belong to the category foundation from PR #49, and Inventory owns only v11 in this scope.
8. Add indexes only for demonstrated list/filter/history query plans and include migration/upgrade coverage.

## UX/accessibility requirements

1. Preserve progress and active filters across list→detail→back navigation when reasonable; do not force re-entry.
2. Browser history/back works for Inventory hub, subsection lists and entity details.
3. Search inputs provide immediate local input feedback; remote searches are debounced/cancelled where appropriate.
4. Prevent duplicate creates/edits/deletes and stale-request UI races.
5. Maintain visible keyboard focus, semantic headings/tables/forms, labels, status text beyond color and WCAG AA contrast.
6. Respect reduced motion; gestures are enhancement rather than the only interaction.
7. No horizontal page overflow at supported mobile widths.
8. Bottom navigation/FAB and sticky actions never obscure content or focused form fields.

## Acceptance

1. `Planes` is completely absent from primary navigation and its previous slot is now `Inventario` on both mobile and expanded navigation.
2. Inventory overview matches reference 01 and routes to Products, Categories, Stores and Statistics.
3. Product list and detail/edit/delete states match references 02 and 03, with server-side pagination/search/filtering and dependency-aware deletion.
4. Category list/new/detail/delete states match reference 04 while supporting arbitrary-depth validated hierarchy.
5. Store list/detail/delete and Statistics states match reference 05 using real canonical data and safe deletion semantics.
6. Ticket history/editor/item-editor/delete states match reference 06 and preserve immutable ticket/price evidence.
7. Every destructive action revalidates impact server-side and surfaces changed dependencies rather than deleting stale assumptions.
8. Mobile swipe actions have keyboard/button equivalents and match existing Basketra progressive swipe behavior.
9. No affected reference view has unexplained visual differences in final screenshot review.
10. Existing critical receipt capture, OCR/AI, lists, catalog matching, realtime and operations flows remain regression-green.
11. List queries handle pagination, filters, search, sorting and stale-response races.
12. Screenshot regression tests compare affected states against the committed references with a documented low tolerance; visual differences require explicit approval and baseline update.
13. Browser tests cover mobile/desktop critical paths, keyboard, focus, no-horizontal-overflow, loading/error/empty states and delete confirmation/preflight.
14. `pnpm quality`, security/CodeQL, container checks and Browser E2E are green on the final implementation head.

## Tests planned

- navigation regression proving Plans removed and Inventory occupies its slot
- repository/API pagination/search/filter/sort tests for products, categories, stores and ticket history
- deterministic page-boundary and stale-query cancellation tests
- product/category/store delete-preflight and transactional revalidation tests
- preservation tests for receipt evidence, price observations and category hierarchy during delete/edit flows
- derived-statistics contract tests
- ticket date/metadata/line correction tests preserving original evidence
- Playwright mobile/desktop list/detail/create/edit/delete workflows
- swipe plus keyboard/button equivalence tests
- screenshot parity tests for every committed reference/state
- accessibility and horizontal-overflow checks

## Delivery

Implement this as a separate redesign scope stacked on the category foundation from PR #49. Do not merge, release or deploy without explicit user approval. The six PNG files and JSON visual-reference manifest are permanent task artifacts and must not be regenerated, optimized, cropped or replaced unless the user explicitly approves new visual baselines.

## Runtime decisions and evidence

- `src/api/inventory-read-model.ts` is the single read owner for Inventory Statistics and historical-ticket collection queries. `src/api/inventory-ticket-management.ts` owns historical-ticket detail, PATCH, delete impact and DELETE. `src/api/inventory-management-core.ts` is restricted to Store CRUD/detail/delete-impact; duplicate ticket/statistics implementations were removed so unsafe historical mutations cannot reappear through a parallel owner.
- Historical ticket edits preserve `receipt_items.original_description`, append `receipt_corrections`, tombstone removed lines with `status = 'deleted'`, and block hard deletion when immutable captures, extractions, corrections, external evidence or retained price observations are present.
- Historical line totals and discounts are derived through `/api/v1/receipts/calculate-line`; the browser does not own receipt arithmetic. Percentage input is parsed exactly to integer basis points and date filters preserve the browser-local calendar boundary before UTC conversion.
- Store and Statistics views cancel or ignore obsolete requests. Statistics period changes use a dedicated generation plus `AbortController`, and initial activation avoids duplicate loads.
- Composite entity URLs are resolved by `src/web/routes.js`: routes such as `catalog:<id>`, `categories:<id>`, `stores:<id>` and `ticket-history:<id>` activate the correct base view while preserving the full deep link. Secondary views keep the correct primary navigation owner (`Inventario` or `Tickets`).
- Static assets are controlled only by `src/api/static-assets.ts`; Inventory, Ticket History and shared route/value helpers are served through that allowlist.
- The reference KPI named as inventory value cannot truthfully represent stock valuation because Basketra currently has no canonical stock-quantity/threshold owner. The current implementation preserves the KPI position but labels the computable value as recent catalog value and explicitly states that it is not stock. This is the minimum domain-safety divergence; it remains subject to final visual review and explicit approval if judged visually material.
- The dependency merge with PR #49 preserves the global migration sequence rather than feature-local numbering: runtime settings remain immutable v8, category hierarchy/receipt category persistence is v9, canonical `category_unknown` normalization is v10, and the Inventory schema extension is v11.
- Primary navigation readiness is now a real interaction boundary: while `#main` is `aria-busy=true`, primary navigation buttons are disabled. This prevents a click from resolving while `navigate()` only records `pendingRoute`, which previously let direct file/input interaction happen before `initReceipts()` registered its handlers.
- Category save completion owns navigation only while the initiating hash still owns the operation. Metadata/list refresh may complete after the user navigates away, but a stale save response cannot reopen category detail or replace the newer route.

## Validation evidence

Regression coverage includes navigation/Plans removal, static-asset serving, schema upgrade through v11, Store management, Statistics aggregation, ticket evidence preservation, exact historical value parsing, API-owner uniqueness, composite route resolution, Ticket History mobile/desktop flows and deep links, Store mobile detail/edit/delete impact, Statistics accessible table equivalents, stale-period response protection, bootstrap/category race protection, responsive touch targets and no-horizontal-overflow assertions/screenshots in the Playwright scenarios.

The final runtime/UI head `3c4d77f32a059824fffba17e60f882903dc8b300` passed Pull Request Quality run `33778452972`: all 106 Browser E2E scenarios passed with no retries, and Quality, Security, container smoke, linux/amd64 and linux/arm64 all completed successfully. CodeQL run `33778453065` also completed successfully. The Browser artifact contained 172 PNG files; the compact screenshot artifact `9902954900` has SHA-256 `9ac41ccb77c7fc5b30a34f70d7a033dbd25d3cc9471526818a894ae0ad1a962b`.

Final visual review did not accept the first green runtime head blindly. Inspection of the exact `db2ac99c` Ticket History editor screenshot found `CANTIDAD` and `UNIDAD` overflowing into one another. Commit `524fd434e85c38a9c89f5db33a77cdfe8ad18a3e` added a browser geometry regression and `3c4d77f32a059824fffba17e60f882903dc8b300` fixed only the two owned grid minimums. The exact-head screenshot then showed both headers in independent readable columns, and the regression passed as scenario 97 inside the 106/106 run. Inventory overview, Product list/editor/delete, Categories desktop/mobile, Stores, Statistics and Ticket History mobile/desktop/editor evidence were reviewed without another blocking layout regression.

The visual evidence publisher then exposed a separate CI contract defect: `.github/workflows/pr-visual-evidence.yml` still searched for the retired Playwright directory fragment `catalog-management-saved-c`, while the authoritative scenario now generates `catalog-management-invento...`. Runtime evidence itself was present and valid. Commit `2806c5e23a7916a4fa8d49e21e3991505737a18a` updates only that selector; its diff is one line added and one removed. `spec.md` was subsequently synchronized with the verified v4-v11 migration ownership, including v8 runtime settings, v9 category hierarchy/receipt category persistence, v10 canonical `category_unknown` normalization and v11 Inventory extensions.

Because the workflow and documentation commits move the PR head without changing runtime behavior, exact-head CI and direct visual-evidence publication must be rechecked after these documentation changes. The PR body is the final external record for the resulting head SHA and Actions run IDs so this spec does not require a self-referential documentation commit after CI completes.

The latest pre-documentation functional head `5dfb1589b8c550a340c96854345d89721100204a` passed Pull Request Quality run `33981534501`: Browser E2E completed **135/135** in 14.8 minutes, Browser changed-code coverage covered 2188 lines, 261 functions and 809 branches at 100%, and Quality, Security, container smoke, linux/amd64 and linux/arm64 all succeeded. CodeQL Advanced run `33981534482` succeeded. Publish PR visual evidence run `33981534464` also succeeded for the same head and published the exact-head media/comment using the unique `retailer-confirmed.png` selector. The Quality log additionally emitted the ALCAMPO database proof with `ticketCount=1`, `productCount=2` and `priceObservationCount=2`.

## Status

Runtime implementation and affected-screen visual review are complete on `agent/feat-professional-inventory-redesign`; PR #51 remains open, non-draft and mergeable. Plans runtime/sentinel code is removed; Inventory Products/Categories/Stores/Statistics and Ticket History have dedicated runtime surfaces and server boundaries; historical evidence safety has a single canonical API owner; the latest functional Browser suite is 135/135 on `5dfb1589b8c550a340c96854345d89721100204a` with 100% changed-code Browser coverage; and direct visual-evidence publication is green on that same head. This documentation synchronization is intentionally non-functional, so its resulting exact-head CI and final PR-body synchronization remain the external completion gate to avoid a self-referential documentation commit. The six approved PNG files remain unchanged and authoritative. No merge, release or deploy has been performed.
