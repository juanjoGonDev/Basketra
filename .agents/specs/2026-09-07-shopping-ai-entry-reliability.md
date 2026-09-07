# Shopping-list AI entry reliability

## Request

Fix the Shopping List product-category AI suggestion flow that can report the AI as unavailable, and expose a first-class action for adding shopping-list items with AI from the item-entry actions.

## Evidence

- Shopping List currently receives one `aiConfigured` boolean during application bootstrap.
- A transient failure while reading `GET /api/v1/settings/ai-provider` is converted to `false` and remains stale for the lifetime of the page.
- The existing multi-item AI flow already owns `POST /api/v1/ai/shopping-list-analysis`, editable proposals, and canonical Shopping List item creation.
- That flow is currently hidden behind the list overflow menu as `Añadir varios con IA`.
- Existing category suggestion already calls the canonical server endpoint `POST /api/v1/categories/suggest` and must continue using the configured provider and server-owned Category inventory.

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

Status: implementation in progress.
