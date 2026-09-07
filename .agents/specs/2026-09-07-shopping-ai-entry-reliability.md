# Shopping-list AI entry reliability

## Request

Fix the Shopping List product-category AI suggestion flow that can report the AI as unavailable, and expose a first-class action for adding shopping-list items with AI from the item-entry actions.

## Evidence

- Shopping List receives one `aiConfigured` boolean during application bootstrap.
- A transient failure while reading `GET /api/v1/settings/ai-provider` is converted to `false` and can remain stale for the lifetime of the page.
- The existing multi-item AI flow already owns `POST /api/v1/ai/shopping-list-analysis`, editable proposals, and canonical Shopping List item creation.
- That flow was hidden behind the list overflow menu as `Añadir varios con IA`.
- Existing category suggestion already calls the canonical server endpoint `POST /api/v1/categories/suggest` and continues using the configured provider and server-owned Category inventory.
- The reproduced category failure was a stale browser option set: the AI can return a valid category id that exists in SQLite after the page loaded, while the product editor still lacks that option and previously reported `La categoría sugerida ya no está disponible`.
- WebAPI accepts Basketra's current nested Chat Completions reasoning-effort shape, so reasoning serialization was ruled out as the cause.

## Decision

1. Keep the existing AI endpoints and proposal/item-creation owners.
2. Add a visible Shopping List entry action, `Añadir con IA`, beside Create Item and Scan.
3. Reuse the existing AI assistant dialog rather than introducing another flow.
4. Resolve AI configuration on demand when the assistant is opened and when analysis/photo AI is requested. A stale bootstrap failure must not permanently disable AI.
5. Do not add a client-side availability gate to Category suggestion. Let the canonical server endpoint decide availability at request time.
6. Improve Category suggestion error feedback so configuration and transient provider failures are distinguishable while manual category selection remains available.
7. Preserve mobile-first layout, keyboard semantics, live status feedback, cancellation/stale-response behavior, and no polling.

## Acceptance

- A transient bootstrap failure for `GET /api/v1/settings/ai-provider` does not permanently block Shopping List AI actions.
- Opening the visible `Añadir con IA` action rechecks AI configuration.
- `Preparar propuesta` rechecks configuration and reaches `POST /api/v1/ai/shopping-list-analysis` when configuration becomes available after bootstrap.
- Product photo AI uses the same live configuration check.
- Shopping Product `Sugerir categoría con IA` still reaches `POST /api/v1/categories/suggest` independently from the stale bootstrap boolean.
- Category suggestion surfaces an actionable configured/unconfigured/provider-unavailable message and retains manual fallback.
- The existing overflow-menu AI action remains a compatible secondary entry point.
- 320 px and 390 px Shopping List entry actions do not create horizontal page overflow.
- No backend API, database schema, dependency, deployment, or public contract changes.

## Checks

- Focused Browser regression for bootstrap AI failure followed by recovery.
- Browser regression for visible AI action and category-suggestion request.
- Existing Shopping List Browser flow.
- Unit/static UI contract where applicable.
- Repository quality/CI authority.

## Delivery

Branch: `agent/fix-shopping-ai-entry`

Status: implementation complete. Final delivery remains gated by the exact-head PR checks.

## Validation evidence

- Pull Request Quality run `34135991795` completed successfully after a targeted retry of external Docker registry failures.
- The initial container failures were upstream HTTP 500 responses while resolving Docker Hub / BuildKit resources before application build evaluation; the targeted rerun passed linux/amd64, linux/arm64 and container smoke.
- Browser shard `11/56` initially exposed a test assertion defect: generated product text lives in an editable input value rather than form text content. The assertion was corrected without product-code changes, and the rerun passed.
- The final code head before this evidence-only specification update passed Static quality, Unit, Integration, Security, Changed coverage, Domain coverage, Web coverage, Build, Resource budgets, Browser runtime/shards/coverage, container smoke, linux/amd64 and linux/arm64.
- CodeQL Advanced run `34135991813` completed successfully.
- The browser regression verifies 390 px and 320 px entry layouts without horizontal document overflow, bootstrap AI recovery without page reload, editable chat proposals, and stale category-option refresh.


## Scope extension: Inventory store-price comparison

### Request

Add a responsive product-price comparison in Inventory and a fast way to add/update a store price directly from a product detail.

### Evidence

- `POST /api/v1/products/:id/prices` already owns canonical manual price observation creation.
- Price observations are immutable historical evidence; an "update" must append a newer observation rather than overwrite an older row.
- Catalog `latestPrices` already de-duplicates by product + retailer + physical-store identity, selecting the newest observation per location.
- The existing query ranks those latest-per-location rows by observation recency, which is unsuitable for direct cheapest-to-most-expensive comparison.

### Decision

1. Keep immutable `price_observations` as the single price history owner.
2. Reuse `POST /api/v1/products/:id/prices`; do not create a parallel Inventory price API.
3. Keep one latest price per location identity and order the resulting comparison by `priceMinor ASC`, then deterministic retailer/store identity.
4. Display retailer-only observations explicitly as no physical store rather than merging them with a named store.
5. Add a compact product-detail price editor using canonical stores from `GET /api/v1/stores/suggestions`.
6. Saving a price appends evidence with `evidenceType=manual`, then reloads the canonical product detail so comparison and history update from the server response path.
7. "Update" pre-fills the selected store and its latest price, but still appends a new observation.
8. Prevent duplicate submit, validate positive euro input and store selection, and preserve usable loading/error states.
9. The comparison must be responsive with no horizontal page overflow at 320/390 px and accessible without relying on color.

### Acceptance

- Multiple observations for the same physical store render once using the newest observation.
- Two physical stores of the same retailer remain distinct.
- Latest store prices are ordered cheapest to most expensive with deterministic tie-breaking.
- Retailer-only/no-store evidence cannot suppress or duplicate a physical-store row.
- The cheapest row is identifiable by text, not color alone.
- Add price opens a fast editor with store and price.
- Update on a comparison row pre-fills that location and price.
- Saving creates a new immutable observation through the existing endpoint and refreshes comparison/history.
- Invalid empty store, zero/negative/invalid monetary input, duplicate submit and API failure are covered.
- Playwright covers desktop and 390/320 px mobile states plus no-horizontal-overflow.
- Changed code maintains 100% changed-code coverage including branches/edge cases under the repository coverage gates.
