# Realtime Shopping List Ticket Redesign

## Request

Redesign Basketra's shopping-list experience as a modern, responsive, realtime shared shopping ticket.

The user-provided prototypes are **content and behavior references only**. Their device chrome, exact geometry, typography, phone frame and incidental bottom-navigation destinations are not visual baselines and must not be copied. The functional content inside the shopping-list, item-editor and product-editor surfaces is normative and is decomposed in the three JSON artifacts committed with this specification.

Required outcome:

- the open shopping list reads visually like a ticket/receipt rather than a collection of unrelated cards;
- multiple visible devices converge in realtime without polling;
- a list can select one reference Store and each item may independently override it;
- the list shows an approximate total derived from the latest saved comparable price at the effective Store for each item;
- adding an item shows suggestions from already-saved catalog data before creating anything new;
- quantity, unit and product size/package remain directly editable;
- product creation can reuse an existing canonical parent or create a new one;
- product photo capture may use AI to extract product metadata, price and normalized price context;
- after photo AI completes, it must populate the **same canonical product/item form** the user would have edited manually from the beginning; no second proposal form remains as a parallel workflow;
- product-photo analysis uses WebAPI's **low reasoning variant** for latency;
- Store selection can reuse saved Stores, opt in to location-based suggestions, or explicitly create/confirm a new Store;
- exact money/quantity/estimate calculations remain server-owned.

## Repository evidence

The current main baseline is `88a9d90daa65a1106381d9b41659db1a838354e7`.

Existing reusable owners already present on this baseline:

- `src/web/lists.js` already connects the open list to `/api/v1/realtime` through `EventSource`, coalesces invalidations and performs no polling.
- `src/realtime/hub.ts` already publishes bounded invalidations for shopping lists/items, products, categories, Stores and price observations.
- shopping lists/items already use optimistic versions and explicit `409 SHOPPING_CONFLICT` recovery.
- `GET /api/v1/products/suggestions` and the current item sheet already provide saved-product suggestions.
- product-photo proposal already extracts canonical/variant name, brand, EAN, category, description, package amount/unit, quantity/unit, price, retailer, Store name, confidence and warnings.
- saved Store suggestions, opt-in geolocation and explicit bounded OpenStreetMap/Overpass discovery already exist.
- latest catalog prices already preserve retailer and physical Store identity.
- the global schema head is migration 14; any persistence required by this scope starts at additive migration 15 and must not rewrite earlier migrations.
- current product creation always creates a new canonical parent and variant together; selecting an existing parent therefore requires an explicit domain/API extension.
- current product-photo UX still reveals a separate proposal editor; this scope removes that parallel-form behavior for the list/product creation flow.
- Basketra's AI provider currently sends one configured model identity to WebAPI. WebAPI's OpenAI-compatible contract supports request-level reasoning effort and its low variant maps to low reasoning. Therefore this scope must request low effort per product-photo operation rather than inventing a second model id.

## Prototype content authority

The following files are committed in the same first specification commit:

1. `.agents/specs/assets/2026-09-05-shopping-list/prototype-shopping-list.json`
2. `.agents/specs/assets/2026-09-05-shopping-list/prototype-item-editor.json`
3. `.agents/specs/assets/2026-09-05-shopping-list/prototype-product-editor.json`

Rules:

- JSON `content` and `behavior` are normative.
- JSON `appearance` defines direction, not pixel geometry.
- Existing Basketra shell/navigation remains authoritative outside these three surfaces.
- Do not add prototype-only primary destinations such as `Ideas` merely because they appear in a mock phone shell.
- Do not use literal wording such as “Añadir por formulario”. The approved mode labels are `Crear`, `Escanear` and, in the full product editor, `Manual`.

## Domain decisions

### 1. Store selection

A shopping list owns one optional **reference Store**.

Each list item owns an optional **Store override**:

- no override => inherit the list reference Store;
- explicit Store override => use that Store for this item.

The UI exposes:

- list-level reference Store selection;
- per-item Store selection;
- an explicit “use for all items” action in the Store chooser that atomically clears item overrides and applies the selected reference Store.

Do not denormalize the inherited effective Store into every item.

Migration 15 should add only the minimum nullable foreign-key fields needed for this ownership, with indexes justified by actual estimate/list queries. Store deletion impact must include active shopping-list references so a Store cannot disappear while a list still depends on it without an explicit reassignment/clear action.

### 2. Item quantity, unit and size

Keep one owner per concept:

- shopping-list item quantity/unit describes what the user wants to buy;
- canonical product variant package amount/unit describes the chosen product size;
- changing the size selector to another saved size switches the linked variant;
- choosing a new/unknown size opens the canonical product editor to create/edit a variant instead of persisting a list-only duplicate product package definition.

The list row and item editor must expose quantity, unit and size/package. Existing exact unit normalization from `src/domain/units.ts` is reused; no floating-point money or quantity calculations are added in the browser.

### 3. Parent product reuse

The product editor calls the canonical parent a **Producto base**.

Creating a product must support either:

- selecting an existing canonical product and creating/selecting a variant under it; or
- creating a new canonical product and its first variant.

Extend the existing product domain/API rather than creating a parallel “shopping product” table. Parent/category/description ownership remains canonical-product data; brand/EAN/package remains variant data.

### 4. Approximate Store-based estimate

The estimate is a server-owned read model, not browser arithmetic.

For each pending item:

1. resolve effective Store = item override or list reference Store;
2. require a linked canonical variant;
3. choose the latest confirmed price observation for that exact variant and effective physical Store;
4. use the observation's exact package quantity/unit and canonical variant package metadata where required to establish comparable units;
5. normalize through the existing exact rational unit functions;
6. scale the latest confirmed price to the requested quantity using rational arithmetic;
7. return integer minor-unit estimated money plus the normalized display basis (`€/kg`, `€/L`, `€/ud`, `€/pack`, etc.);
8. if Store, product, price or comparable quantity metadata is missing, return an explicit unpriced reason and exclude that item from the known total.

The list estimate response must expose at least:

- known estimated total in integer minor units;
- priced item count;
- unpriced item count;
- coverage;
- oldest price observation timestamp contributing to the total;
- per-line effective Store;
- per-line latest price timestamp;
- per-line normalized price basis;
- per-line estimated total;
- explicit reason when a line cannot be estimated.

The UI must label this as an **Estimación**, never as a checkout total or current guaranteed price. Old observations remain usable because the user explicitly asked for the latest saved price; their age is shown rather than silently discarded.

### 5. Realtime convergence

Preserve the existing SSE invalidation architecture and no-polling invariant.

Estimate/list UI must resync when relevant invalidations arrive for:

- shopping-list;
- shopping-list-item;
- product;
- Store;
- price-observation.

Store selection and item Store overrides are optimistic-versioned mutations. Concurrent edits must retain the existing explicit conflict UX instead of last-write-wins.

Two open devices on the same list must converge for item completion, quantity/unit changes, size/variant changes, Store changes and estimate changes.

### 6. Suggestions

Typing in `Producto` continues to use saved local catalog suggestions first.

Suggestions should include enough contextual data for the active list to decide quickly:

- variant name;
- canonical parent;
- brand/category when available;
- package size;
- latest price at the effective Store when available;
- age of that price.

Requests are debounced and stale responses are aborted/ignored.

Selecting a suggestion links the canonical variant and hydrates the same item draft. “Crear nuevo producto …” opens the canonical product editor with the typed text prefilled.

### 7. Product photo / AI

The camera/photo path is a **draft autofill path**, not a second product workflow.

Required flow:

1. user chooses `Escanear` or `Foto / IA`;
2. validate against live WebAPI attachment capabilities before upload;
3. store through the existing FileStore;
4. invoke `product-photo-proposal`;
5. keep Basketra's configured WebAPI model identity;
6. request WebAPI low reasoning only for this operation using request-level `reasoning.effort = "low"`;
7. when the structured result returns, hydrate the exact same canonical product/item draft fields and switch to editable/manual state;
8. visibly mark warnings/confidence without duplicating the form;
9. persist nothing until the user presses the normal explicit create/add action.

Do **not** interpret image `detail: "low"` as the user's requested low model. That is a separate image-resolution control and must not be changed without evidence because EAN/price text may need detail.

If AI fails, the uploaded image and all user-entered draft values remain available and the user continues manually.

Ticket scanning from the `Escanear · Producto o ticket` entry delegates to the existing receipt/ticket capture flow. Do not collapse a multi-line ticket into the single-product form.

### 8. Location and Store creation

Location remains opt-in and is never requested on page load.

Store chooser order:

1. saved Stores;
2. saved Stores ranked by deterministic distance after explicit location permission;
3. explicit bounded nearby OpenStreetMap/Overpass lookup when local results are insufficient;
4. reuse the existing Store creation editor for a new Store.

An external nearby candidate is not persisted until explicit confirmation. Location is not sent to the AI product-photo request.

## UI/UX contract

### Shopping list

- continuous ticket/receipt visual surface for pending items;
- product rows are separated, not individually carded;
- product identity and price are primary;
- quantity, unit, size and Store remain editable;
- right-aligned estimated line totals;
- one reference Store control above the ticket;
- explicit unpriced state for non-comparable lines;
- estimate footer with known total, coverage and oldest contributing price age;
- completed products remain visually secondary/collapsible;
- `Crear ítem` and `Escanear` are distinct high-priority actions;
- realtime state stays compact and non-blocking;
- an explicit `Seleccionar` button switches the list into multi-select mode;
- multi-select rows replace edit/swipe affordances with selection controls and a bulk action bar;
- bulk actions include select all, mark bought, return to pending, change/inherit Store and delete;
- bulk mutations are transactional and version-checked so a conflict cannot partially update the selected set.

### Item editor

Content order is the JSON contract:

1. mode: `Crear` / `Escanear`;
2. product search/suggestions;
3. selected-product state;
4. quantity;
5. unit;
6. weight/size;
7. Store;
8. line estimate;
9. `Editar ficha y precio`;
10. `Foto / IA`;
11. `Añadir`.

### Product editor

Content order is the JSON contract:

1. `Escanear` / `Manual`;
2. `Producto base` search or `Crear nuevo`;
3. variant;
4. details: quantity, unit, size, package content;
5. extra: brand, EAN/GTIN, category;
6. price and Store;
7. server-derived normalized price;
8. `Crear y añadir`.

### Responsive behavior

- mobile first;
- 320 px remains usable with no horizontal page overflow;
- controls wrap instead of shrinking below touch target/legibility thresholds;
- desktop may align controls into columns but cannot remove or rename required content;
- sticky/floating actions must not cover list rows, Store selectors or focused fields;
- keyboard, focus, screen reader labels, reduced motion and WCAG AA remain required;
- existing swipe actions remain enhancements with button/keyboard equivalents.

## API/read-model direction

Exact endpoint names may be adjusted during implementation if existing owners provide a better cohesive boundary, but the ownership must remain:

- ShoppingRepository: authoritative list/item/reference-Store/override persistence and optimistic versions.
- CatalogRepository: canonical products/variants/categories/Stores/confirmed price evidence.
- one dedicated shopping estimate read owner for Store-specific latest-price selection and exact estimate math.
- RealtimeHub: invalidation only; no payload duplication and no polling.

Likely contracts:

- list/detail payload exposes reference Store;
- item payload exposes Store override and effective Store identity;
- product suggestions accept active Store context;
- a bounded estimate endpoint returns the server-owned estimate snapshot;
- list Store selection supports a semantic scope enum (`default` or `all`) rather than a vague boolean flag;
- item PATCH supports explicit Store override clear/set;
- product creation supports an existing canonical parent id without duplicating the parent.

Untrusted request values are runtime validated.

## Security, privacy and telemetry

- preserve the LAN/VPN deployment trust model from `AGENTS.md`;
- do not add public-client rate-limit semantics without evidence;
- WebAPI remains attachment-capability SSOT;
- geolocation is opt-in and never sent to product-photo AI;
- external Overpass lookup is explicit and bounded;
- no product names, receipt contents, image bytes, coordinates, auth headers or provider secrets in logs;
- useful sanitized telemetry: estimate duration/counts, realtime reconnect state, product-photo operation duration/result class and low-effort selection, without sensitive payload content.

## Acceptance

1. The open list visually reads as one modern ticket/receipt and remains responsive from 320 px through desktop.
2. All functional content represented in the three prototype JSONs is present; prototype layout/device chrome is not copied.
3. Two devices on the same list converge without polling.
4. List reference Store can be selected and changed.
5. Any individual item can override its Store.
6. “Use for all” clears overrides and applies one Store atomically.
7. Each pending line shows its latest comparable saved price for its effective Store when available.
8. Estimate total is server-derived, uses exact rational/unit math, excludes unpriced lines and shows coverage plus price age.
9. Quantity, unit and size/package are editable without creating duplicate sources of truth.
10. Product suggestions prefer existing saved catalog data and include Store-price context when available.
11. Product editor can select an existing canonical parent or create a new one.
12. Product photo analysis uses WebAPI low reasoning for this operation and then fills the same manual form; there is no separate proposal form.
13. AI failures preserve draft progress and allow manual completion.
14. Normalized price (`€/kg`, `€/L`, `€/ud`, etc.) is server-derived.
15. Saved Stores are offered first; location is opt-in; nearby external candidates require confirmation before persistence.
16. Ticket scanning continues through the existing multi-line ticket flow.
17. Existing shopping conflict handling, swipe accessibility, routes, Inventory, Tickets and receipt workflows remain regression-green.
18. No horizontal page overflow, hidden CTA, duplicate submit or stale-response overwrite occurs in supported viewports.
19. Completing an item is reversible: the immediate success feedback exposes “Deshacer”, and every completed row exposes a visible “Volver a pendientes” action so accidental completion never strands an item outside the active list.
20. A visible `Seleccionar` control enters multi-select mode across pending and completed items; the user can select individual items or all loaded items, then atomically mark them bought/pending, change their Store override or delete them with confirmation.

## Tests planned

### Domain/integration

- migration 14 -> 15 upgrade and fresh-database setup;
- list reference Store persistence and foreign-key behavior;
- item Store override inherit/set/clear semantics;
- transactional apply-to-all Store selection;
- Store delete-impact includes active shopping-list references;
- latest exact Store price selection;
- estimate exact rational math for unit, mass and volume;
- estimate unpriced reasons: no Store, no linked product, no Store price, non-comparable units;
- coverage/oldest-observation calculation;
- suggestion Store-price context;
- create variant under existing canonical parent without duplicating parent;
- product-photo request carries low reasoning effort while configured model identity remains unchanged;
- product-photo result does not persist until explicit confirmation;
- location/Overpass candidates remain unpersisted until confirmation.

### Browser

- mobile 320/390 and desktop ticket rendering;
- inline quantity/unit/size/Store editing;
- reference Store change and per-item override;
- apply-to-all behavior;
- two browser contexts converge over SSE;
- realtime price-observation invalidation refreshes estimate;
- saved-product suggestion selection;
- new product parent search/create;
- photo AI loading -> same form autofilled -> editable -> submit;
- AI failure recovery preserving draft;
- opt-in location and nearby Store confirmation;
- keyboard/focus/screen-reader equivalents;
- no horizontal overflow and no action obstruction;
- conflict/recovery state for stale item/Store edits;
- accidental completion -> immediate undo -> completed row visible return-to-pending action;
- multi-select mode -> individual/select-all -> bulk complete/pending/Store/delete -> realtime convergence and conflict atomicity.

## Rollback

Implementation must be reversible without data loss.

- migration 15 is additive only;
- rolling back application code may leave the new nullable columns/indexes inert;
- do not write a destructive down migration;
- immutable price observations and receipt evidence remain untouched;
- if estimate/read-model code is rolled back, persisted list/item/product/Store data remains valid.

## Delivery

First delivery milestone is this specification commit only. Implementation begins after this commit and must follow TDD-light, affected checks, full quality, Browser E2E, exact-head CI and final visual/runtime review before the PR is considered ready.

No merge, release or deploy is authorized by this request.

## Status

Specification captured. Implementation not started.
