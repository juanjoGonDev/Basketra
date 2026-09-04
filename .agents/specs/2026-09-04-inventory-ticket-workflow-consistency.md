# Inventory and ticket workflow consistency

## Request

Continue PR #51 from the user's current local branch state and make the professional Inventory/Ticket workflows consistent:

- reuse the same invoice-style receipt-line editor for editing an existing line and adding a manual line;
- stop blocking historical-ticket deletion merely because immutable evidence exists; a confirmed deletion must delete the ticket-owned evidence graph;
- make Product detail a full-page view instead of a contextual drawer/split preview;
- add Product history with a readable chart and supporting accessible data;
- keep Ticket History editing visually modern and aligned with the receipt-line editor;
- add explicit multi-selection to professional paginated lists, with selection preserved across page navigation for supported bulk actions.

## Evidence

- The current historical-ticket add/edit flow already reuses receipt invoice presentation helpers, but it owns a second dialog shell/markup and can drift from the live receipt-line editor.
- Ticket deletion currently computes capture/extraction/correction/evidence/price impact and disables the confirm action when any immutable evidence exists.
- Receipt-owned captures, extractions, items and corrections have direct receipt/item cascade foreign keys. Receipt-projected external evidence and price observations are linked by canonical receipt-item source references and must be explicitly removed before deleting the receipt.
- Product routes already use #catalog:<productId> and a separate detail screen, but desktop CSS presents that state as a contextual split preview.
- Catalog data already owns latest price observations. A full history needs a bounded chronological read model, not chart math duplicated in the browser.
- Product, Category and Ticket History use offset pagination. Store lists and other Inventory lists need the same explicit selection interaction where actions are actually supported.
- The user's local branch includes later shell/breadcrumb/dialog/store-classification changes; these must be preserved.

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

- #catalog:<id> is a full product route/view on desktop and mobile; no drawer/split overlay.
- Detail keeps identity, category, brand, EAN, package, latest prices, retailer names and editing.
- Add a bounded chronological price-history endpoint/read model for a product variant, including store/retailer, observedAt, priceMinor and confidence where applicable.
- UI renders an accessible chart plus an equivalent table/list so information is not encoded only visually.
- Chart arithmetic/aggregation is server-owned where aggregation is needed; the browser only maps returned points to coordinates.
- Loading, empty and error states are explicit.

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

## Tests

- Unit/contract: shared line-editor shell is the sole dialog-chrome owner.
- Browser: add and edit line share structure/classes/sections/actions on desktop/mobile.
- Integration: delete-impact returns warning counts but canDelete=true for existing tickets; destructive delete removes the receipt-owned evidence graph and rolls back on failure.
- Integration: deleting a ticket does not delete a shared product variant/listing/store/category.
- API/read-model: bounded product history ordering, filtering and maximum size.
- Browser: full-page product detail with chart/table, deep link/back, loading/empty/error, no horizontal overflow.
- Browser: explicit selection persists across pagination, clear selection works, hidden-page selection count is announced, row activation remains independent.
- Integration/Browser: batch delete/preflight is atomic or returns deterministic structured blocked results according to endpoint contract.
- Full quality/security/container/CodeQL/Browser and exact-head visual review.

## Rollback

- Editor reuse can be reverted independently because domain payloads remain unchanged.
- Product full-page/history is additive to the existing #catalog:<id> route and can be reverted without schema migration.
- Multi-selection is additive UI/API behavior and must not change single-item endpoints.
- Ticket-delete semantics are the only destructive behavior change; rollback restores evidence-blocking preflight/DELETE guard. No schema migration is required.

## Delivery

Branch: agent/feat-professional-inventory-redesign
PR: #51
Base: main

No merge, release or deploy without explicit user approval.

## Status

In progress from user-local head 234681f9aaa99f7950625a945f9ce3401cac0d46.
