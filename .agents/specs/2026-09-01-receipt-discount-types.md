# Receipt typed discounts

## Request

Support receipt-line discounts as an explicit exclusive concept: no discount, a fixed EUR amount, or a percentage. Keep receipt arithmetic authoritative on the server/domain, extend AI structured extraction, preserve ambiguous evidence for manual review, and redesign the line editor so the discount type/value and derived total are clear and responsive.

## Evidence

- Baseline is `main` at `26133f7be0e2280089c65e3548d91847ab6dde19` after merged PR #45.
- `src/domain/receipt.ts` currently owns line arithmetic but accepts only optional `discountMinor`.
- `src/api/receipt-calculation.ts` currently accepts only optional `discountMinor` for `/api/v1/receipts/calculate-line`.
- `src/receipts/extraction.ts` exposes only optional `discountMinor` in the AI schema and does not instruct the model how to encode typed discounts.
- `src/web/receipt-review.js` injects one editable `Descuento (€)` input; `src/web/api.js` sends that amount to the backend calculation endpoint.
- `src/web/ui.js` renders the derived total as an input. `src/web/api.js` appends the obsolete help text `Se actualiza al cambiar cantidad, precio o descuento.`.
- `receipt_items.discount_minor` is the persisted effective monetary discount used by the confirmed receipt projection. Immutable extraction payloads are stored separately in `receipt_extractions.deterministic_json` / `receipt_extractions.ai_json`, and user corrections are stored as generic JSON in `receipt_corrections`.
- This persistence shape means percentage intent can remain in immutable AI evidence and/or correction JSON while the confirmed receipt projection stores the locally validated effective monetary amount. A schema migration is therefore not required for this change.
- Real Alcampo evidence includes `50% dto BEBIDA COCO 0% A 0,88-`. When two identical item rows make ownership ambiguous, attaching the discount to either row would fabricate evidence.
- `src/web/sw.js` caches the changed receipt web assets and therefore requires a cache-version bump when those files change.

## Decisions

1. Introduce a tagged domain discount type:
   - `{ type: 'amount', amountMinor }`
   - `{ type: 'percentage', basisPoints }`
   - absence means no discount.
2. Preserve legacy `discountMinor` at input boundaries for compatibility, but reject payloads that contain both the legacy and typed representations. Internal new flows use the tagged representation.
3. `calculateReceiptLineTotal()` remains the arithmetic owner and delegates only to a colocated effective-discount helper. Percentage arithmetic uses `BigInt` integer math, with basis points (`10_000 = 100%`) and half-up rounding to the nearest cent. Example: 50% of EUR 1.75 produces an effective discount of EUR 0.88.
4. Validate non-negative safe integers, percentage range `0..10_000`, amount not exceeding subtotal, subtotal overflow, malformed tagged objects, and mixed typed/legacy representations.
5. `/api/v1/receipts/calculate-line` accepts the typed discount contract and legacy `discountMinor`, rejects mixed forms, and returns both `lineTotalMinor` and the locally resolved `discountMinor` so callers never calculate the effective amount themselves.
6. The AI item schema uses the same tagged discount concept. AI-proposed totals and discounts are locally validated by the receipt domain before they can become confirmed review state.
7. Add structured `unassignedDiscounts` to AI interpretation for visible discount evidence whose item ownership is ambiguous. It carries the typed discount, source lines, optional description hint and reason. The model must leave item discounts unset in that case and emit a warning/manual-review signal.
8. Do not modify immutable capture/OCR evidence. Preserve typed AI values inside `ai_json`. Final confirmed receipt rows continue storing only the validated effective amount because `receipt_items` is an arithmetic/price-observation projection; typed user corrections are retained in `receipt_corrections` when the user changes discount intent.
9. The editor uses one discount-type `select` (`none`, `percentage`, `amount`) plus one conditional value input. Switching type clears the previous value before requesting recalculation. Cancel restores the original type/value.
10. Derived total becomes semantic `<output>` presentation, not an editable-looking input. Calculation status remains an empty live region until pending/success/error feedback is required; the obsolete explanatory sentence is removed.
11. Quantity, unit price, discount type and discount value all drive the existing bounded, abortable backend recalculation path. Save, explicit line validation, whole-ticket validation and confirmation remain blocked while the latest calculation is pending or failed.
12. Reuse Basketra tokens/components only; no dependency is added.
13. Bump the service-worker shell cache because `api.js`, `app.js`, `receipt-review.js`, `receipt-review.css` and `ui.js` are cached assets.

## Acceptance criteria

- No discount, fixed amount and percentage discounts calculate correctly through one domain arithmetic owner.
- Percentage discounts use integer basis points and documented half-up cent rounding; 0% and 100% are valid.
- Percentages above 100%, negative/malformed values, amount above subtotal, unsafe overflow and mixed representations are rejected.
- Existing `discountMinor` amount flows remain accepted at compatibility boundaries.
- `/api/v1/receipts/calculate-line` parses typed percentage/amount discounts and rejects invalid/mixed inputs.
- AI structured output accepts valid tagged discounts, rejects malformed discount objects, and locally validates arithmetic.
- Alcampo-style `50% dto ... 0,88-` can be represented as a percentage discount.
- Ambiguous duplicate items do not receive an arbitrary discount; structured unassigned discount evidence and warning/manual review remain visible to the client.
- Editor exposes one exclusive type selector and one value control, never two independently editable discount values.
- Changing discount type/value requests backend recalculation; switching type does not retain stale value.
- Derived total is semantic/read-only and visually distinct from inputs; obsolete help text is absent.
- Save/validate/confirm remain blocked on pending/error calculation and stale responses cannot overwrite newer intent.
- Cancel restores the original discount type/value.
- Corrections record typed discount changes while immutable extraction evidence and historical price observations are not rewritten.
- Mobile and desktop layouts have no horizontal overflow or total-field misalignment; controls have labels, visible focus and screen-reader semantics.
- Existing receipt validation/recovery suites remain green.
- Service-worker cache contract reflects changed web assets.
- Exact PR-head required CI and visual-evidence workflows are green before completion.

## Scope

### In scope

- Receipt discount domain types and arithmetic.
- Receipt calculation, validation and confirmation parsing boundaries.
- AI receipt schema, instructions, validation and ambiguous-discount evidence.
- Receipt line editor, async calculation coordinator and responsive styles.
- Receipt-focused unit, integration and Playwright regression coverage.
- Service-worker cache version.

### Out of scope

- Rewriting immutable receipt evidence.
- Rewriting historical price observations.
- Broad receipt-schema redesign or unrelated database migration.
- New dependencies, polling, deployment, release or merge.
- Unrelated UI redesign.

## Risks

- A percentage can produce a fractional cent; rounding must be stable and identical everywhere. Mitigation: one BigInt half-up implementation in the domain with boundary tests.
- Legacy clients can still send `discountMinor`. Mitigation: keep a compatibility parser and explicitly reject mixed legacy/typed representations.
- AI may see a discount line that cannot be uniquely associated with repeated products. Mitigation: structured unassigned evidence plus warning; never guess ownership.
- Dynamic editor state can race the calculation coordinator when the type changes. Mitigation: clear the value synchronously, version requests, abort stale work and block acceptance while pending/error.
- Cached browser assets can leave mixed old/new UI code. Mitigation: bump the shell cache version and retain the existing service-worker asset contract tests.

## Tests

- Domain: none, amount, percentage, rounding, 0%, 100%, >100%, negative/malformed values, amount above subtotal, overflow, mixed representation and legacy compatibility.
- API/integration: typed amount/percentage parsing, legacy amount, malformed/mixed rejection.
- AI: schema parse valid amount/percentage, malformed/mixed rejection, local arithmetic validation, Alcampo 50%/0.88 regression, ambiguous duplicate ownership retained as unassigned evidence.
- Browser: safe type switching, backend recalculation after type/value changes, semantic non-editable total, obsolete copy absent, cancel restoration, typed correction payload, pending/error action blocking, desktop/mobile no overflow/alignment.
- Existing receipt validation, recovery, durable extraction and service-worker suites.
- `pnpm quality` through the repository quality gate and exact-head GitHub Actions.

## Rollback

Revert the commits from this branch. No database migration or destructive data rewrite is introduced, so rollback only restores the former amount-only contract and browser assets. Existing persisted `discount_minor` values remain valid.

## Checks

- [ ] Focused domain/API/AI tests.
- [ ] Focused browser receipt tests.
- [ ] Service-worker shell tests.
- [ ] `pnpm quality`.
- [ ] Production build/runtime smoke covered by CI.
- [ ] Desktop and mobile visual evidence reviewed for overflow, alignment, focus and result affordance.
- [ ] Exact final-head CI green.

## Delivery

- Branch: `agent/fix-receipt-discount-types`
- Target: `main`
- PR: new, non-draft, title `fix(receipts): support typed line discounts`
- Merge/release/deploy: prohibited for this task.

## Status

In progress. Reconnaissance and persistence decision completed; implementation and validation pending.
