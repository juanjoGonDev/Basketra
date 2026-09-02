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
5. Mobile uses cards/rows and the established short-left-swipe interaction to reveal Edit/Delete. Accessible pointer/keyboard/button equivalents are mandatory.
6. Query/action state is race-safe; stale remote responses cannot overwrite newer search/filter/page state.
7. Loading, empty, no-results, error and success states use application components, never browser-native alerts/confirms/prompts.

### Products

1. Product list follows reference 02 with search by relevant identifiers, filters, sorting, stock/status signals, pagination and concise hierarchy/store/price context.
2. Product detail is a dedicated view/route following reference 03.
3. Parent/category relationships are explicit links to separate dedicated entity views.
4. Product detail surfaces linked stores, recent prices, ticket history and notes without duplicating historical sources of truth.
5. Editing follows the reference side-panel/sheet language with server/domain validation authoritative.
6. Product deletion requires a server-side dependency preflight showing at least ticket usage, linked store/inventory usage and price-history impact.
7. If hard deletion would violate immutable receipt evidence or price-observation history, block it or expose the safe detach/deactivate operation and explain why.

### Categories

1. Category list follows reference 04 with pagination, search, filters, sorting, color indicators and expandable arbitrary-depth hierarchy.
2. Category detail is a dedicated view/route; parent categories open their own dedicated views.
3. `Nueva categoría` is a dedicated creation view/form with name, parent, color, description and live hierarchy preview.
4. Edit/reparent preserves acyclic hierarchy and `category_unknown` invariants.
5. Category deletion preflight shows direct product count plus descendant/subcategory impact, including descendants that contain products.
6. `category_unknown` / `desconocido` is protected and cannot be deleted.
7. Destructive actions never silently orphan products or descendants.

### Stores

1. Stores are a first-class Inventory subsection following reference 05.
2. Provide paginated/searchable/filterable list, create, dedicated detail, edit and delete workflows.
3. Store detail includes location/metadata, linked product counts, ticket/activity summary and recent activity.
4. Store deletion preflight shows linked product and historical ticket counts.
5. Block hard deletion while required historical/evidence relationships cannot be preserved; provide reassignment/deactivation where appropriate instead of cascading evidence destruction.

### Inventory Statistics

1. Statistics is a first-class Inventory subsection following reference 05.
2. Provide at least Overview, Categories and Stores perspectives.
3. Include actionable KPIs and charts represented in the reference when supported by canonical data: inventory value, product counts, ticket activity, category distribution, store activity, ticket evolution, uncategorized products and low-stock indicators.
4. Statistics are derived/read-only views over canonical data, never a second source of truth.
5. Charts require accessible text/table equivalents and deterministic contracts.

### Ticket history

1. Tickets gains a historical list following reference 06.
2. History is paginated and supports search plus relevant date-range, store, category, status/payment and sorting/filter controls.
3. Show period summary metrics such as ticket count, total spend, item count and average ticket when derivable canonically.
4. Mobile rows support the established swipe affordance with equivalent accessible actions.
5. A historical ticket opens a dedicated detail/editor; do not edit the entire history inline.

### Ticket detail/editor

1. Follow the invoice-style editor in reference 06.
2. Editable metadata includes date/time, store, payment/status and notes where supported by the domain.
3. Line items expose product, category, quantity, unit, unit price, discount and backend-derived total.
4. Add/edit/remove lines with the same invoice-style component language already used for ticket-line editing.
5. Ticket totals remain canonical/backend-derived; the frontend never becomes a second arithmetic owner.
6. Historical edits preserve original captures, OCR/AI extraction and immutable historical price evidence; corrections are explicit rather than destructive rewrites.
7. Ticket deletion always uses an explicit application confirmation and displays ticket identity/date/store/total/item impact.
8. If deleting the logical ticket would destroy immutable evidence or price history, block hard deletion and expose the safe supported operation instead.
9. Mobile gestures must not bypass persistence/integrity rules.

## UX and visual parity contract

1. Treat the six PNGs as screenshot baselines for affected views.
2. No intentional visual deviations are accepted unless the user explicitly approves revised references.
3. Match information hierarchy, widths, card/table density, whitespace, corner radii, icon placement, badges, status colors, destructive red treatment, editor positioning and responsive stacking visible in the references.
4. Use canonical Basketra typography/tokens/components where they reproduce the references; extend the canonical design system rather than adding one-off page systems.
5. No browser-native `alert`, `confirm` or `prompt`.
6. WCAG AA, keyboard operability, visible focus and semantic controls remain mandatory.
7. Mobile must not introduce horizontal page overflow or broken viewport behavior/accidental zoom.
8. Swipe is an enhancement, never the only path to edit/delete.
9. Destructive actions show clear consequence language and authoritative dependency counts before commit.

## Data and API requirements

1. Reuse and extend existing canonical product/category/store/ticket owners; do not create parallel repositories for the same concept.
2. Pagination/filter/search parameters have one canonical API contract per entity and deterministic ordering.
3. Select cursor or offset pagination according to existing query characteristics, but expose stable semantics and test boundary pages.
4. Delete preflight/impact counts are computed server-side from canonical relationships; the browser never infers them.
5. Delete mutations revalidate dependencies transactionally to prevent TOCTOU between warning and commit.
6. Preserve immutable price observations, original receipt extraction/captures and append-only correction history.
7. Realtime remains invalidation-only; clients re-read canonical state without domain polling.

## Acceptance

1. Plans is absent and Inventory occupies its former main-menu position.
2. Inventory overview matches reference 01 at representative mobile/desktop viewports.
3. Product list/detail/edit/delete states match references 02-03 and satisfy pagination/search/filter requirements.
4. Category list/detail/new/delete states match reference 04, including hierarchy and dependency warnings.
5. Store list/detail/delete and Inventory Statistics match reference 05.
6. Ticket history/detail/item editor/delete states match reference 06.
7. Product/category/store lists do not render every entity plus a full editor in one unbounded view.
8. Parent entity navigation opens a separate dedicated detail view.
9. Delete warnings show authoritative dependency counts and destructive operations preserve evidence/history invariants.
10. Mobile swipe edit/delete has accessible equivalents.
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

## Status

Specification and visual contract defined. Runtime implementation has not started.