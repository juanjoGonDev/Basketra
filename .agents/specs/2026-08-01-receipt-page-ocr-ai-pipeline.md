# Receipt page OCR and AI pipeline

## Request

Improve multi-image receipt processing so every capture is handled independently, local OCR text is verified by the configured AI provider as text, and page results are assembled in physical order without duplicating overlap. Show progress inside each capture card, detect the retailer, preserve partial work, support retry/cancellation, and keep at most two receipt pages in flight.

The supplied Alcampo example establishes these expected facts:

- retailer: `ALCAMPO ALMERIA`;
- declared total: `202,26 EUR`;
- article count: `88`;
- quantity prefixes can be printed on the line before the product, for example `6 x ,89` followed by `C.LADRON MANZAN 5,34 A`;
- consecutive photos of a long receipt can overlap substantially.

The source request is preserved in the uploaded task text and attached receipt photographs; production photographs must not be committed to the public repository.

## Evidence

- The original `ReceiptExtractionService.extract` looped captures sequentially, concatenated every OCR page, then sent the complete combined text to AI once.
- The original browser exposed only one global indeterminate progress panel and received no page-level stage information.
- `TesseractCliOcrProvider` intentionally serializes local OCR to one process, one OpenMP thread and bounded output. This remains the resource safety boundary for Raspberry Pi.
- The original deterministic parser handled inline `product quantity x unit total` lines but not a standalone quantity prefix followed by a priced product line.
- The original overlap removal used a global signature set and could remove legitimate repeated purchases outside the actual page boundary.
- webApi contains an internal `createPromisePoolQueue` around browser executions. It is not a remote job API: Basketra cannot enqueue a correlated page job, inspect its state, cancel a queued item, or reuse that queue contract. Basketra must therefore own page orchestration while webApi remains the OpenAI-compatible provider.
- webApi supports bounded OpenAI-compatible structured outputs and its own provider-side request queue. Basketra does not need a webApi runtime or public API change for this feature.

## Decisions

1. Keep the canonical receipt extraction endpoint and call it with one capture per page:
   - the first request performs local OCR;
   - the second request supplies that page's OCR as bounded `embeddedText` and enables AI verification;
   - a final deterministic request assembles the already validated page text in capture order.
   This avoids a second protocol owner while still exposing page stages in the browser.
2. The browser owns one FIFO receipt-page pool with concurrency `2`, page-level abort controllers and stale-result generations. The server independently limits receipt page operations to two active tasks across requests.
3. Local OCR stays serialized internally. Two page pipelines may overlap only when one page is waiting on AI while another uses OCR, or when two AI verifications are active.
4. The AI receives OCR text only for image verification. Images are not forwarded after local OCR. PDF behavior remains capability-based and separate.
5. AI output uses a strict JSON Schema and includes corrected text, retailer, optional article count/total, ordered items, tax category, source-line references, confidence and warnings.
6. Deterministic parsing is extended for standalone quantity prefixes, decimal commas without a leading zero, tax letters and article-count summaries.
7. Assembly is page-aware. It removes only the longest matching suffix/prefix sequence between adjacent pages and never applies a global product signature set.
8. Exact duplicate captures with the same storage key are collapsed server-side. Similar or overlapping photographs with different content remain independent pages.
9. A failed or cancelled page preserves completed pages. Confirmation remains unavailable until every retained capture is completed; the user must retry or remove incomplete captures.
10. Retailer autofill never overwrites a manual edit. Conflicting detected candidates are surfaced as explicit choices.
11. Real uploaded receipt photographs are treated as private evidence and are not committed. Tests use redacted OCR fixtures derived from the visible receipt structure plus synthetic image fixtures already used by the repository.

## Scope

### In scope

- receipt extraction domain and service;
- bounded page-operation queue on the existing receipt endpoint;
- browser page pool, cancellation, retry, stale-result protection and retailer detection;
- capture-card progress UI and responsive styles;
- regression tests and exact-head visual evidence.

### Out of scope

- database schema changes;
- storing tax-category or article-count columns as authoritative receipt-item fields;
- a distributed queue, worker service or resident OCR process;
- changing webApi public contracts;
- deployment, release, Raspberry environment or secrets.

## Acceptance criteria

- Each retained capture has one visible state: pending, preparing, OCR, AI verification, completed, error or cancelled.
- The capture card shows image index, stage, elapsed time, partial result, actionable error, retry and cancellation controls.
- No more than two page pipelines are active in the browser; no more than two receipt page operations run concurrently on the server.
- Queue slots are released after success, failure or cancellation.
- Global cancellation prevents pending work from starting and aborts active requests where possible.
- Individual cancellation affects only that page.
- OCR output from each image is sent separately to AI as text and validated through JSON Schema.
- The Alcampo fixture parses `6 x ,89` plus `C.LADRON MANZAN 5,34 A` as quantity `6`, unit price `89`, line total `534`, tax category `A`.
- Equivalent `2 x 1,00`, `6 x ,50`, `2 x 2,48` and `2 x 1,64` examples are covered.
- Retailer `ALCAMPO ALMERIA`, total `20226` minor units and article count `88` are detected from the fixture.
- Adjacent overlap is removed, while a legitimate repeated product later in the receipt remains.
- Partial page success remains visible after another page fails.
- Confirmation is blocked while a retained page is pending, running, failed or cancelled.
- Existing manual review, corrections, idempotent confirmation and retailer suggestions continue to work.
- UI has no horizontal overflow and remains legible at 320, 360, 390, 430, 768 and desktop widths in light and dark themes.

## Tests

- bounded FIFO queue concurrency, slot release and waiting-task cancellation;
- per-page OCR and AI verification through the existing extraction endpoint;
- AI schema rejection, provider failure, retry and redaction boundaries;
- standalone quantity-prefix parsing and tax category extraction;
- retailer, total and article-count metadata;
- adjacent overlap assembly, exact duplicate collapse and preservation of real repeats;
- per-page and global cancellation in Playwright;
- responsive capture progress cards and theme coverage;
- integration through Basketra's real OpenAI-compatible provider contract using a deterministic local HTTP fixture.

## Checks

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm deadcode`
- `pnpm deps:check`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm test:coverage`
- `pnpm build`
- `pnpm test:browser`
- `pnpm quality`
- container smoke, AMD64, ARM64, security, CodeQL and exact-head visual evidence in CI

## Risks

- Two concurrent AI calls can increase provider pressure. Mitigation: fixed concurrency `2`, server bound, provider queue and user cancellation.
- OCR/AI page boundaries can make one product span two images. Mitigation: preserve source lines, merge only adjacent boundaries and require review for ambiguity.
- Overlap matching can remove a genuine repeated boundary sequence. Mitigation: longest adjacent sequence only, numeric agreement and a conservative description match.
- Additional browser state can become stale after reordering/removing captures. Mitigation: extraction generation tokens and full invalidation on order/content changes.
- Sensitive ticket evidence could leak into logs or repository fixtures. Mitigation: fixed error codes, no body logging and redacted synthetic text fixtures.

## Rollback

Revert the pull request. No migration, provider protocol, external queue or persistent data rollback is required. Existing stored captures and receipts remain compatible.

## Delivery

- branch: `agent/feat-receipt-page-pipeline`;
- target: `main`;
- normal non-draft pull request after final validation;
- no merge, release, deployment, protected-branch change or Raspberry mutation without explicit authorization.

## Status

Implementation complete on the feature branch:

- page-local OCR followed by text-only AI verification;
- browser and server concurrency bounds of two;
- page states, elapsed time, retry and cancellation inside capture cards;
- retailer, total, article-count, split-quantity and tax-category parsing;
- adjacent overlap assembly with exact duplicate capture collapse;
- unit, integration and Playwright regression coverage;
- PWA cache invalidation for the new receipt workflow.

Implementation head `4bb5004ccc8460576ecb3c1455e33859e4ae3c3d` passed repository quality and resource budgets, security, browser acceptance, container smoke, linux/amd64, linux/arm64, CodeQL and exact-head visual-evidence publication. The pull request is marked ready only after this final documentation head repeats the same required gates.
