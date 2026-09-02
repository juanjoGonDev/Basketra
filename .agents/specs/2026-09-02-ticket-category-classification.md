# Ticket Category Classification

## Request

Add first-class hierarchical product categories to Basketra and integrate them into receipt AI verification. Categories may nest recursively through `parentId`, carry a user-visible color, and must be manageable from the application. Receipt AI must receive the current category inventory, classify each extracted product line, propose any missing categories, and use the default `desconocido` category whenever it cannot classify safely.

The receipt analysis JSON must expose the selected category for each item plus a root `newCategories` collection describing categories proposed during that analysis.

## Evidence

- `product_categories` already exists as the persisted category source of truth, but migration v4 models it as a flat global-name registry with only `id`, `name`, `description` and timestamps.
- `canonical_products.category_id` already links products to persisted categories; introducing a second category store would duplicate the domain concept.
- `GET/POST/PATCH /api/v1/categories` already exist, but the current contract cannot represent hierarchy or color and the frontend has no first-class category-management view.
- Receipt verification already uses a strict JSON Schema in `src/receipts/extraction.ts`; both the direct provider path and the durable Responses API path consume that same schema.
- Durable receipt verification persists job input and remote response identity. A category inventory snapshot can therefore travel with the job so retries/restarts do not silently change the model context.
- `receipt_items` currently has no category reference. Without a persisted classification the AI result would be lost after receipt confirmation and the catalog projection would continue creating uncategorized products.
- Existing receipt catalog projection preserves original receipt evidence and must continue doing so.
- The current product/category specification says categories are flat and that AI never persists category changes. This request supersedes those two category-specific restrictions while retaining the rule for products, prices, stores and other AI proposals.

## Decision

- Extend `product_categories` additively with nullable `parent_id` and `color`; do not replace the table or rewrite applied migrations.
- Keep category names globally case-insensitive unique in this iteration. Hierarchy does not require duplicate names, and global uniqueness makes AI references deterministic.
- Add the stable root fallback category `category_unknown` / `desconocido`. It cannot be renamed or nested under another category. Its display color is a neutral valid hex color.
- Category colors use canonical `#RRGGBB` values. The server validates and normalizes them; the browser does not own color syntax rules.
- Prevent self-parenting and ancestor cycles. Parent references must identify an existing category or, while resolving an AI proposal, another category proposed in the same response.
- Add a first-class `Categorías` application view using the existing no-dependency frontend, design tokens and navigation patterns. Mobile remains a single-column tree/list plus editor flow; wider layouts may place hierarchy and editor side by side.
- The category API remains the only manual persistence boundary and is extended with `parentId` and `color`.
- Receipt AI receives a compact snapshot containing every persisted category's `id`, `name`, `parentId` and `color`. New receipt jobs persist that snapshot in their internal request so retries/restarts use the same context.
- Each AI receipt item returns `categoryId`. It must reference an existing category id, `category_unknown`, or a temporary `new:<token>` id declared in the same response.
- AI receipt JSON adds required `newCategories`. Each proposal contains a temporary `id`, `name`, nullable `parentId`, canonical `color`, and optional description. `parentId` may reference either an existing category or another temporary id in the same response.
- The model is instructed to reuse an existing semantically suitable category, avoid cosmetic duplicates, create only genuinely missing categories, and select `category_unknown` for insufficient evidence.
- AI does not receive direct database capability. After strict structured-output validation, the server resolves the proposals at the trusted persistence boundary. Existing names are reused case-insensitively; missing categories are created topologically and idempotently; temporary references are replaced with persisted ids before the completed job result is exposed.
- If semantic category resolution is invalid (unknown parent/reference or a cycle), receipt extraction itself remains usable: affected references fall back to `category_unknown`, no partial invalid hierarchy is committed, and a bounded warning is added.
- Persist `category_id` on confirmed `receipt_items`. Confirmation defaults a missing category to `category_unknown` for deterministic/manual extraction compatibility.
- When receipt catalog projection creates a new canonical product, apply the confirmed receipt category to that product without changing `original_description`, extraction evidence, corrections or price observations. Existing catalog matches are not silently recategorized by a later receipt.
- Keep `newCategories` in the completed analysis as the set of categories actually materialized by that analysis, with persisted ids and persisted parent ids.

## Acceptance

1. Schema migration upgrades existing databases without destructive operations and preserves every existing category/product relationship.
2. `desconocido` always exists after migration with stable id `category_unknown` and is the fallback for unclassified receipt lines.
3. Categories support arbitrary acyclic nesting through `parentId`; self-parenting and ancestor cycles are rejected.
4. Categories may store a validated `#RRGGBB` color and expose it through repository/API responses.
5. `GET /api/v1/categories` returns `id`, `name`, `parentId`, `color`, optional description and timestamps.
6. `POST/PATCH /api/v1/categories` can create/reparent/recolor categories while preserving the protected fallback category invariants.
7. A first-class `Categorías` view lists the hierarchy, indicates color, exposes parent relationships, and supports create/edit without browser-native dialogs.
8. The category view works as a one-column workflow on narrow mobile widths and can use additional desktop space without changing the task order.
9. Every AI-verified receipt request receives the persisted category snapshot including `id`, `name`, `parentId` and color.
10. Durable job input stores the category snapshot used for analysis; restart/retry never silently substitutes a different snapshot for an already-created job.
11. The strict receipt JSON schema requires `items[].categoryId` and root `newCategories` for AI verification.
12. AI can reference newly proposed categories through temporary `new:*` ids, including a new child whose parent is another new category from the same response.
13. Valid proposals are materialized atomically/idempotently at the server boundary and temporary ids are replaced by persisted ids in the completed result.
14. Invalid semantic category proposals never create a partial hierarchy; affected receipt lines fall back to `category_unknown` with a bounded warning instead of losing the receipt extraction.
15. Receipt confirmation persists `category_id`; non-AI/manual confirmation falls back to `category_unknown` when no category is supplied.
16. Newly projected catalog products inherit the confirmed receipt category, while already matched existing products are not silently recategorized.
17. Receipt original descriptions, OCR/AI evidence, correction history and price observations remain immutable except for their existing append-only behavior.
18. Unit/integration tests cover migration, fallback seeding, hierarchy/cycle validation, color validation, AI schema/context, temporary-reference resolution, idempotency, fallback behavior and receipt confirmation persistence.
19. Browser coverage exercises category create/edit/hierarchy states and confirms responsive/keyboard-operable behavior without console/network regressions.
20. `pnpm quality`, relevant browser tests, security/CodeQL and container checks are green on the final PR head before handoff.

## Scope

Included:

- category hierarchy and color persistence
- stable `desconocido` fallback
- category API contract extensions
- first-class category management UI
- receipt AI category inventory context
- receipt AI JSON category/new-category contract
- trusted server-side category proposal materialization
- confirmed receipt category persistence and new-product projection
- focused unit, integration and browser regressions
- specification/documentation updates

Excluded:

- category deletion or bulk merge
- duplicate category names under different parents
- automatic recategorization of existing products from later receipts
- AI writes for products, retailer/store metadata, prices or other entities
- new UI/component/state-management dependencies
- merge, release or deploy

## Risks

- A very large category inventory increases AI prompt size. The serialized context is intentionally compact and contains only classification fields; no descriptions are sent unless a future measured need justifies them.
- Global category-name uniqueness may eventually be too restrictive for domain-specific homonyms. Relaxing it would require a separate identity/disambiguation design and is outside this change.
- Concurrent analyses can propose the same new category. Case-insensitive uniqueness plus idempotent resolution must converge on one persisted category rather than duplicate or fail the receipt.
- Reparenting changes hierarchy for every product using that category. Manual category editing therefore remains an explicit user action; AI proposals only create missing categories and never reparent existing ones.
- Existing in-flight jobs created before this feature have no category snapshot. They use only the stable fallback category rather than reading a mutable live inventory mid-recovery.

## Tests

- migration upgrade and fresh-database tests for schema v8 and `category_unknown`
- category repository tests for nested create/update, color normalization, protected fallback and cycle rejection
- category API integration tests for hierarchy/color validation and response shape
- receipt structured-schema unit tests for required category ids and new-category proposals
- direct AI-provider request tests proving compact category inventory context is sent
- durable Responses API tests proving the stored snapshot is sent and preserved through reconciliation/retry
- category materialization tests for existing reuse, parent-before-child creation, duplicate proposals, concurrent/idempotent reuse and invalid-cycle fallback
- receipt confirmation/import tests for category persistence and new catalog product inheritance
- browser tests for category inventory management at mobile/desktop representative viewports and keyboard interaction
- existing receipt extraction, durable recovery, catalog projection and product catalog regressions
- `pnpm quality`
- Playwright Browser E2E and repository CI/security/container workflows

## Rollback

Application behavior can be rolled back by reverting the feature commits. Schema v8 is additive and must not be manually removed from an upgraded production database; older application versions ignore the added category columns and `receipt_items.category_id`. The seeded fallback row is ordinary non-secret catalog data. No receipt evidence or price history is rewritten.

## Delivery

Use atomic Conventional Commits on `agent/feat-ticket-category-classification`, push the branch, open a non-draft PR, inspect all required CI and browser evidence, fix owned failures, and do not merge/release/deploy.

## Status

Specification created from main `f598e97c771bc918947de6adc8e42a780f97e12d`. Implementation and validation are pending.
