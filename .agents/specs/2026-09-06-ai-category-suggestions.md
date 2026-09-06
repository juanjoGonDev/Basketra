# AI Category Suggestions

## Request

Add one fast AI-assisted category suggestion action when creating or editing an item from Inventory Products, historical Ticket lines, and Shopping Lists.

The action must:
- reuse one server request and one AI structured-output contract across all surfaces;
- send the item information already filled by the user plus the current persisted category inventory;
- use WebAPI reasoning effort `low` for low-latency responses;
- require enough surface-specific form data before sending anything to AI and mark/focus missing required fields when the button is pressed;
- only suggest an existing persisted category; it must never create, rename, reparent, recolor, or otherwise mutate categories;
- apply the suggestion to the current form for user review without saving the item automatically.

## Evidence

- Basketra's generic AI provider already centralizes provider configuration, structured output, retry/cancellation and stable error mapping in `src/ai/provider.ts` and `src/ai/structured-executor.ts`.
- Basketra currently sends OpenAI-compatible Chat Completions requests without a reasoning-effort override. WebAPI accepts the standard additive `reasoning_effort` field and maps `low` to its fast/Instant execution mode.
- `CategoryRepository` / the database category read model is the canonical source of category identity and hierarchy. Clients must not provide the category inventory used for model grounding.
- Inventory Product creation already requires canonical name and variant name before save.
- Historical Ticket line editing already requires product description, quantity and unit price.
- Shopping List item creation already requires product text, quantity and unit; its optional global-product proposal editor owns the category selector used when a catalog Product is created.
- Receipt extraction has a separate category-classification contract that may propose new categories. This feature is intentionally narrower: manual-form suggestions choose only from existing categories.

## Decision

### Server contract

Add `POST /api/v1/categories/suggest`.

Request:
- `name`: required non-empty item/product name.
- optional bounded context fields: `variantName`, `description`, `brand`, `quantity`, `unit`, `unitPriceMinor`, `packageMinor`, `packageUnit`.
- clients never send category IDs/names as the available inventory.

Server behavior:
1. Validate and bound the request.
2. Read the current persisted category inventory from the canonical category owner.
3. If there are no categories other than the protected unknown fallback, return no suggestion without invoking AI.
4. Execute one structured AI operation with `reasoningEffort: 'low'`.
5. Send a compact category inventory containing only classification fields required to identify the existing category.
6. Require structured output `{ categoryId: string | null, confidence: number, reason: string }`.
7. Accept a non-null `categoryId` only when it identifies a category from the exact inventory snapshot sent to the model. Unknown IDs fail closed to no suggestion.
8. Return the selected category identity/name plus confidence/reason for UI feedback. Do not persist anything.
9. Support request abort and keep the existing bounded retry/error behavior.

### Provider contract

Extend `AiStructuredInput` with optional `reasoningEffort: 'low' | 'medium' | 'high'`. The OpenAI-compatible adapter emits `reasoning_effort` only when supplied. Existing AI callers remain unchanged.

### Shared browser owner

Add one reusable browser helper for:
- validating a declared list of required controls;
- marking missing controls with `aria-invalid=true` and a visible field error;
- focusing the first missing/invalid required control;
- cancelling a previous category-suggestion request on the same form;
- calling `/api/v1/categories/suggest`;
- applying the returned existing category ID to the supplied select;
- exposing checking/success/no-match/error states without auto-saving.

Surfaces:
- Inventory Product: require canonical name and variant name; include optional brand/description/package context; apply to `#catalog-category`.
- Historical Ticket line: require description, valid positive quantity and valid unit price; include unit; apply to `#historical-ticket-line-category`.
- Shopping List: require product text, valid positive quantity and unit. The suggestion action reveals/reuses the existing global-product proposal editor as needed and applies to `#proposal-category`; saving remains the user's explicit action.

The button label and status must make clear that AI is suggesting, not assigning authoritatively.

## Acceptance

1. All three surfaces call the same `POST /api/v1/categories/suggest` endpoint.
2. Every AI call for this operation contains `reasoning_effort: "low"`.
3. The server, not the browser, supplies the current persisted category inventory.
4. The AI can only select an existing category from that snapshot; malformed/unknown IDs never mutate the form.
5. Inventory Product suggestion does not send until canonical name and variant name are valid; pressing the button marks/focuses missing fields.
6. Historical Ticket suggestion does not send until product, quantity and unit price are valid; pressing the button marks/focuses missing fields.
7. Shopping List suggestion does not send until product, quantity and unit are valid; pressing the button marks/focuses missing fields.
8. A successful suggestion updates only the category select and visible status; it never submits/saves the parent form.
9. A newer click/input state cannot be overwritten by an older response.
10. AI unavailable/rate-limited/failed states leave the form usable and category manually selectable.
11. Keyboard and screen-reader users can operate the suggestion action and receive checking/result/error feedback.
12. Browser tests cover the three surfaces, missing-required-field behavior, successful suggestion, no-match, error and stale-response cancellation.
13. Unit/integration tests cover request validation, category inventory grounding, existing-ID enforcement and the `low` provider request field.
14. `pnpm quality`, Browser E2E, Security, CodeQL and container checks are green on the final head.

## Risks

- Category inventories can grow. Keep the prompt compact and bounded; do not include product history, prices, receipts or category descriptions unless evidence later proves necessary.
- AI confidence is advisory. Never auto-save or silently persist a category because of a suggestion.
- Duplicate UI implementations would drift. The request lifecycle, validation state and application logic belong to one shared browser helper.
- Existing receipt-AI category materialization is a different workflow and must not be reused to create categories from this manual suggestion action.
- A stale response can overwrite a newer form state. Each surface must cancel or generation-guard previous suggestion work.

## Tests

- provider unit: optional `reasoning_effort` is omitted by default and emitted as `low` for this operation;
- category-suggestion unit: compact context/schema parsing and unknown category ID fail-closed behavior;
- server integration: validation, canonical category snapshot, AI success/no-match/provider error;
- browser Inventory Product: required-field highlighting + category application;
- browser historical Ticket: required-field highlighting + category application;
- browser Shopping List: required-field highlighting + proposal editor/category application;
- browser stale/error/no-match behavior;
- existing AI/provider/category/catalog/ticket/list regressions;
- full repository quality/CI.

## Rollback

Revert the feature commits. No schema migration, persisted-data rewrite, category mutation, public compatibility break, dependency, release or deployment is required.

## Delivery

Use atomic Conventional Commits on `agent/feat-ai-category-suggestions`, push, open a non-draft PR, inspect exact-head CI and visual evidence, fix owned failures, and do not merge/release/deploy.

## Status

Recon and specification complete. Implementation, regression coverage, exact-head CI and final visual review are pending.
