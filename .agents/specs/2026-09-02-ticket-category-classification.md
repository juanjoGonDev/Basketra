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
- Final review found that the category schema extension preserved a pre-existing legacy `desconocido` row with a non-canonical id, violating the stable `category_unknown` acceptance contract even though fresh databases were correct.
- Final review also found that category resolution caught every repository exception and downgraded it to `desconocido`; that would hide SQLite/storage failures even though fallback is specified only for invalid category semantics.
- After PR #50 merged into `main`, migration v8 is already the immutable owner of persisted runtime settings. The category branch therefore cannot retain its former v8/v9 numbering without colliding with an applied migration owned by another feature.
- The merge integration commit `9c5c26c07b4948dcdfd1c4f8eaf0281340ce753a` preserves main's runtime-settings migration as v8 and moves category schema changes to v9/v10. The combined schema head is consequently v10.
- Pull Request Quality on that merge head proved format, lint, typecheck, dead-code, dependency policy, 250/250 unit tests and 72/73 integration tests. The only failure was the runtime-settings regression asserting that the global schema head must remain v8; the runtime settings behavior itself passed. Commit `5392593b87748f1400fce4e4fdcf8724c2e614cc` removes that invalid coupling while retaining the behavioral migration/defaults test.

## Decision

- Extend `product_categories` additively with nullable `parent_id` and `color`; do not replace the table or rewrite applied migrations.
- Keep category names globally case-insensitive unique in this iteration. Hierarchy does not require duplicate names, and global uniqueness makes AI references deterministic.
- Add the stable root fallback category `category_unknown` / `desconocido`. It cannot be renamed or nested under another category. Its display color is a neutral valid hex color.
- Preserve migration v8 exactly as owned by runtime settings from `main`. Apply the category hierarchy/color and `receipt_items.category_id` extension as migration v9, then use migration v10 to normalize a legacy `desconocido` id to `category_unknown` while atomically retargeting category-parent, canonical-product and receipt-item foreign-key references. Both category migrations remain additive/non-destructive and run inside the existing migration transaction.
- Category colors use canonical `#RRGGBB` values. The server validates and normalizes them; the browser does not own color syntax rules.
- Prevent self-parenting and ancestor cycles. Parent references must identify an existing category or, while resolving an AI proposal, another category proposed in the same response.
- Add a first-class `Categorías` application view using the existing no-dependency frontend, design tokens and navigation patterns. Mobile remains a single-column tree/list plus editor flow; wider layouts may place hierarchy and editor side by side.
- The category API remains the only manual persistence boundary and is extended with `parentId` and `color`.
- Receipt AI receives a compact snapshot containing every persisted category's `id`, `name`, `parentId` and `color`. New receipt jobs persist that snapshot in their internal request so retries/restarts use the same context.
- Each AI receipt item returns `categoryId`. It must reference an existing category id, `category_unknown`, or a temporary `new:<token>` id declared in the same response.
- AI receipt JSON adds required `newCategories`. Each proposal contains a temporary `id`, `name`, nullable `parentId`, canonical `color`, and optional description. `parentId` may reference either an existing category or another temporary id in the same response.
- The model is instructed to reuse an existing semantically suitable category, avoid cosmetic duplicates, create only genuinely missing categories, and select `category_unknown` for insufficient evidence.
- AI does not receive direct database capability. After strict structured-output validation, the server resolves the proposals at the trusted persistence boundary. Existing names are reused case-insensitively; missing categories are created topologically and idempotently; temporary references are replaced with persisted ids before the completed job result is exposed.
- If semantic category resolution is invalid (unknown parent/reference, malformed semantic values, duplicate temporary references or a cycle), receipt extraction itself remains usable: affected references fall back to `category_unknown`, no partial invalid hierarchy is committed, and a bounded warning is added. Operational repository/storage failures are not semantic fallback and must propagate.
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
14. Invalid semantic category proposals never create a partial hierarchy; affected receipt lines fall back to `category_unknown` with a bounded warning instead of losing the receipt extraction. Operational repository/storage failures propagate and are never downgraded to semantic fallback.
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
- Migration v10 changes only the primary key identity of a legacy fallback row after retargeting every known foreign-key owner in the same migration transaction; the regression fixture explicitly covers category children, canonical products and receipt items.
- Semantic fallback must remain narrowly scoped. Swallowing SQLite, filesystem or other operational failures would create apparently successful receipt classifications after a failed persistence boundary, so unexpected repository errors are propagated.
- The migration sequence is now shared with the runtime-settings feature. Reusing v8 for categories would be a production migration collision, so migration numbers are treated as immutable global database identities rather than feature-local counters.

## Tests

- fresh-database migration tests for hierarchy/color schema and `category_unknown`
- v9-to-v10 upgrade regression proving a legacy `desconocido` id is normalized without breaking category-parent, canonical-product or receipt-item references after runtime-settings v8
- category repository tests for nested create/update, color normalization, protected fallback and cycle rejection
- category API integration tests for hierarchy/color validation and response shape
- receipt structured-schema unit tests for required category ids and new-category proposals
- direct AI-provider request tests proving compact category inventory context is sent
- durable Responses API tests proving the stored snapshot is sent and preserved through reconciliation/retry
- category materialization tests for existing reuse, parent-before-child creation, duplicate proposals, concurrent/idempotent reuse and invalid-cycle fallback
- resolver regression proving semantic proposal failures fall back while an operational persistence error is rethrown unchanged
- receipt confirmation/import tests for category persistence and new catalog product inheritance
- runtime-settings integration regression proving its persisted defaults remain usable without coupling the test to the global latest schema version
- browser tests for category inventory management at mobile/desktop representative viewports and keyboard interaction
- existing receipt extraction, durable recovery, catalog projection and product catalog regressions
- `pnpm quality`
- Playwright Browser E2E and repository CI/security/container workflows

## Rollback

Application behavior can be rolled back by reverting the feature commits. Category migrations v9 and v10 are additive/non-destructive and must not be manually removed or rewritten on an upgraded production database; older application versions ignore the added category columns and `receipt_items.category_id`. The v10 identity normalization preserves references but should likewise remain recorded as applied. Migration v8 belongs to the already-integrated runtime-settings feature and is not owned or rolled back by this category change. The seeded fallback row is ordinary non-secret catalog data. No receipt evidence or price history is rewritten.

## Delivery

Use atomic Conventional Commits on `agent/feat-ticket-category-classification`, push the branch, open a non-draft PR, inspect all required CI and browser evidence, fix owned failures, and do not merge/release/deploy.

## Status

PR #49 remains open, non-draft and mergeable on `agent/feat-ticket-category-classification`. The conflict with current `main` was resolved by merge commit `9c5c26c07b4948dcdfd1c4f8eaf0281340ce753a`, whose second parent is `main` commit `d3e7b09d7c615256b871bd9ddccad5f04ae68e1a`. The combined migration sequence is now v8 runtime settings, v9 category hierarchy/color plus receipt category references, and v10 canonical `category_unknown` normalization. The durable Responses path preserves #50's binary multipart transport while carrying #49's category snapshot, and receipt processing keeps one consistent operation snapshot for provider settings and category inventory.

On merge head `9c5c26c07b4948dcdfd1c4f8eaf0281340ce753a`, CodeQL Advanced passed. Pull Request Quality passed format, lint, typecheck, dead-code, dependency policy, all 250 unit tests, Security and 72 of 73 integration tests; its sole failure was the obsolete assertion that `CURRENT_SCHEMA_VERSION` must equal 8. Commit `5392593b87748f1400fce4e4fdcf8724c2e614cc` removes that global-version assertion while continuing to instantiate `BasketraDatabase` and read runtime settings defaults from the migrated database. Exact-head CI for the subsequent documentation head must still complete successfully before handoff. The PR body and stable `spec.md` must be synchronized to v8/v9/v10 before final review. No merge, release or deploy has been performed.
