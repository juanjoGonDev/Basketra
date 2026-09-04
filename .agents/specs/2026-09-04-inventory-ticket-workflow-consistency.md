# Inventory and ticket workflow consistency

## Request

Continue PR #51 from the user's current local branch state and make the professional Inventory/Ticket workflows consistent:

- reuse the same invoice-style receipt-line editor for editing an existing line and adding a manual line;
- stop blocking historical-ticket deletion merely because immutable evidence exists; a confirmed deletion must delete the ticket-owned evidence graph;
- make Product detail a full-page view instead of a contextual drawer/split preview;
- add Product history with a readable chart and supporting accessible data;
- keep Ticket History editing visually modern and aligned with the receipt-line editor;
- add explicit multi-selection to professional paginated lists, with selection preserved across page navigation for supported bulk actions.
- replace hash-fragment routing with clean same-origin paths and persist tabs, sub-views, pagination, search and filters in the URL so refresh/back/forward restore the exact workflow state without briefly rendering the default view.
- repair receipt-derived Store/Product linkage when AI detects or proposes a physical store: confirmed receipt price observations must inherit that Store, including observations created before the store-projection migration was installed.

## Evidence

- The current historical-ticket add/edit flow already reuses receipt invoice presentation helpers, but it owns a second dialog shell/markup and can drift from the live receipt-line editor.
- Ticket deletion currently computes capture/extraction/correction/evidence/price impact and disables the confirm action when any immutable evidence exists.
- Receipt-owned captures, extractions, items and corrections have direct receipt/item cascade foreign keys. Receipt-projected external evidence and price observations are linked by canonical receipt-item source references and must be explicitly removed before deleting the receipt.
- At task start Product routes used `#catalog:<productId>` and desktop CSS presented detail as a contextual split preview; the target contract replaces both with a clean full-page route.
- Catalog data already owns latest price observations. A full history needs a bounded chronological read model, not chart math duplicated in the browser.
- Product, Category and Ticket History use offset pagination. Store lists and other Inventory lists need the same explicit selection interaction where actions are actually supported.
- The user's local branch includes later shell/breadcrumb/dialog/store-classification changes; these must be preserved.
- The supplied AI output already contains `retailerName: "ALCAMPO"` and `storeName: "ALCAMPO ALMERIA"`; `receipt-review.js` forwards detected Store data to `/api/v1/receipts/confirm`, and `BasketraDatabase.importReceipt` creates/reuses the Store before inserting receipt lines.
- Migration 12 assigns Store IDs only to newly inserted receipt-derived `price_observations`; it has no backfill for observations projected earlier, while Store product counts are derived from `price_observations.store_id`. Existing receipts can therefore have the correct `receipts.store_id` but still show no Product linkage in Store views.

## Scope

### Receipt-line editor reuse

- Introduce one reusable invoice-line dialog shell/component owner in receipt-editor-invoice.js.
- Live receipt review and historical ticket add/edit consume that owner rather than maintaining parallel dialog chrome.
- Mode-specific controls are allowed, but Product / Detail / Discount / Summary hierarchy, action layout, close/cancel behavior, focus lifecycle and responsive structure remain common.
- Add and edit mode differ only in title, initial data and available destructive action.

### Historical ticket deletion

- Delete confirmation remains mandatory and must show exact impact counts.
- Presence of evidence is a warning, not a hard blocker.
- DELETE runs in one IMMEDIATE transaction.
- Delete ticket-owned price_observations first, then ticket-owned external_evidence, then the receipt. Receipt foreign-key cascades remove captures, extractions, items and corrections.
- Do not delete shared catalog entities (canonical products, product variants, retailer listings, retailers, stores or categories) merely because they were once projected from this receipt; those can be referenced by other receipts/lists and are not receipt-owned.
- After deletion, no external_evidence or price_observation may retain a receipt-item source reference from the deleted ticket.
- API response/impact copy must describe the destructive cascade truthfully.

### Product detail and history

- `/inventory/products/:id` is a full product route/view on desktop and mobile; no drawer/split overlay.
- Detail keeps identity, category, brand, EAN, package, latest prices, retailer names and editing.
- Add a bounded chronological price-history endpoint/read model for a product variant, including store/retailer, observedAt, priceMinor and confidence where applicable.
- UI renders an accessible chart plus an equivalent table/list so information is not encoded only visually.
- Chart arithmetic/aggregation is server-owned where aggregation is needed; the browser only maps returned points to coordinates.
- Loading, empty and error states are explicit.

### Refresh-safe URL state

- Use clean application paths instead of hash fragments. Deep links use path segments (for example product/ticket/store/category detail) and view state uses bounded query parameters.
- The router is the single owner for path <-> internal route conversion and URL mutation. Feature modules consume canonical route/query helpers rather than writing `location.hash` or raw history URLs.
- Direct GET requests for known application paths return the application shell; static assets/API endpoints retain their current explicit routing and 404 behavior.
- Bootstrap applies the requested route synchronously before asynchronous metadata/data loading so a deep-link refresh never renders Home/default first.
- Browser back/forward rehydrates the active view plus feature query state through `popstate` without creating a second history entry.
- Search text updates use replace-state semantics to avoid one browser-history entry per keystroke; committed navigation, pagination, tabs and detail transitions use push-state semantics.
- Persist at minimum: Settings tab; Inventory scope/query; Product/Category/Store/Ticket list page, search, sort/filter controls; Statistics period; entity detail routes; Shopping List detail route. Omit default query values from canonical URLs.
- Legacy hash deep links are accepted only as a one-time compatibility input and are immediately canonicalized to the clean URL.
- URL parsing is fail-closed and bounded: invalid pages, enums or oversized text fall back to canonical defaults rather than reaching API requests unchanged.

### Multi-selection

- Add one reusable client selection owner for professional entity lists.
- Selection is explicit by entity ID and persists across pagination.
- Page changes do not clear selection.
- Filter/search changes do not silently convert selection into matching-all semantics; selected IDs remain explicit and the UI states how many selected items are outside the current page when applicable.
- A clear-selection action is always available.
- Row activation and selection controls remain keyboard/screen-reader accessible and do not conflict.
- Bulk actions are exposed only where the server has a safe canonical operation. Do not add destructive bulk buttons that loop individual requests in the browser.
- Initial supported actions:
  - Ticket History: bulk delete with one impact/confirmation flow and one server transaction/bounded batch endpoint.
  - Products: bulk delete only for products whose canonical delete preflight allows deletion; blocked IDs remain reported, never silently skipped.
  - Categories/Stores: selection UI can be shared, but destructive bulk actions require a canonical batch endpoint/preflight before being enabled.
- Selection state must survive moving between pages and remain bounded to a reasonable maximum.

## Risks

- Ticket deletion is intentionally destructive and can remove receipt capture/extraction/correction/price evidence. Confirmation copy and transactional tests are mandatory.
- Deleting shared catalog entities as part of ticket cascade would cause unrelated data loss; explicitly forbidden.
- Bulk actions can amplify destructive mistakes. No implicit select-all, no client fan-out deletes, no partial-success ambiguity without structured results.
- Product price history can become unbounded; endpoint must cap points and order deterministically.
- Clean-path SPA routing can accidentally turn unknown GETs into shell 200 responses or break static assets; only canonical application path patterns may fall back to index.html.
- URL-driven filters can create request races on popstate/search changes; every feature must keep its existing AbortController/generation guard and apply restored state before issuing the request.
- Reusing the editor must not couple historical ticket save semantics to live receipt DOM mutation.

## Acceptance

- Manual Add article and Edit line render through the same invoice-style dialog shell and share focus/cancel/save lifecycle.
- Historical ticket deletion is enabled after impact loads, even when evidence exists, and its warning enumerates what will be deleted.
- Confirmed ticket delete removes the receipt and all receipt-owned capture/extraction/item/correction/external-evidence/price-observation records atomically.
- Shared catalog/store/category entities remain intact.
- Product detail occupies the full content area on desktop/mobile and route/back navigation remains correct.
- Product detail includes chronological price history as chart + accessible data equivalent, with loading/empty/error states.
- Ticket History keeps the modern invoice-line editing experience for both add and edit.
- Products and Ticket History support explicit multi-selection that survives pagination.
- Supported bulk actions use server-side batch contracts with deterministic per-ID results/preflights.
- Existing single-row actions, filters, pagination, deep links, swipe equivalents, CSP, keyboard access and responsive layouts remain working.
- No canonical application URL contains a hash fragment; refreshing any supported view/detail/tab/page/filter/search state restores it directly without first showing the default view.
- Browser back/forward restores the previous application state, including list query controls, without stale requests overwriting the restored state.
- A Store detected/proposed by receipt AI is represented by the confirmed receipt and every receipt-derived price observation for that ticket; upgrading an existing database repairs missing Store IDs without changing shared Products, listings, evidence or prices.

## Tests

- Unit/contract: shared line-editor shell is the sole dialog-chrome owner.
- Browser: add and edit line share structure/classes/sections/actions on desktop/mobile.
- Integration: delete-impact returns warning counts but canDelete=true for existing tickets; destructive delete removes the receipt-owned evidence graph and rolls back on failure.
- Integration: deleting a ticket does not delete a shared product variant/listing/store/category.
- API/read-model: bounded product history ordering, filtering and maximum size.
- Browser: full-page product detail with chart/table, deep link/back, loading/empty/error, no horizontal overflow.
- Browser: explicit selection persists across pagination, clear selection works, hidden-page selection count is announced, row activation remains independent.
- Integration/Browser: batch delete/preflight is atomic or returns deterministic structured blocked results according to endpoint contract.
- Unit: canonical path/route/query parsing, legacy hash migration, bounded query normalization and default omission.
- Integration: direct GET of every application path serves the shell while unknown/static/API paths retain fail-closed behavior.
- Browser: refresh and back/forward restore Settings tab, list/detail deep links, pagination/search/filters and Shopping List detail without a Home/default-view flash.
- Integration/migration: a schema-12 database with a receipt-owned Store and previously projected price observation lacking `store_id` upgrades by backfilling that observation; current imports continue assigning the Store on insert.
- Full quality/security/container/CodeQL/Browser and exact-head visual review.

## Rollback

- Editor reuse can be reverted independently because domain payloads remain unchanged.
- Product full-page/history is additive to the clean `/inventory/products/:id` route contract and can be reverted without schema migration.
- Multi-selection is additive UI/API behavior and must not change single-item endpoints.
- Ticket-delete semantics are the only destructive behavior change; rollback restores evidence-blocking preflight/DELETE guard. No schema migration is required.

## Delivery

Branch: agent/feat-professional-inventory-redesign
PR: #51
Base: main

No merge, release or deploy without explicit user approval.

## Status

Implementation is complete on the branch. Delivery remains evidence-gated: exact-head CI and final visual review must be green before the task is reported done, and their observed results belong in the PR/final report rather than being predicted here.

- Clean path routing, bounded query-state restoration, direct-GET shell fallback, legacy hash canonicalization and synchronous route bootstrap are implemented.
- Settings tab, Inventory overview state, Product/Category/Store/Ticket filters and pagination, Statistics period, entity details, editor mode and Shopping List detail are represented in the URL; transient destructive selection/drafts remain intentionally non-restorable.
- Shared invoice editor ownership, evidence-warning ticket deletion, full-page Product detail/history and explicit cross-page selection/bulk contracts are implemented with regression coverage.
- The first post-routing Browser run exposed concrete regressions rather than product-domain failures: an undefined invoice-layout variable, a historical editor leaking the generic `.receipt-item` selector, an unclosed desktop media query that swallowed mobile Inventory styles, stale detail-route mocks and a stale child-category URL assertion. Each root cause is fixed and covered on the branch.
- Obsolete contextual Product split-preview CSS has been removed; the full-page detail is now the only maintained presentation path.
- Store/Product projection repair is now in progress from local/remote head `9973da6bf11173495d44a35e1662dad9ce2dc3b1`; the AI extraction path itself carries the Store, so the repair targets persisted receipt-derived price observations and upgrade compatibility.
- No merge, release or deploy has been performed.
