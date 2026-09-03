# Receipt line category visibility

## Request

Show the category assigned by receipt analysis on every reviewed receipt line, both in the compact line preview and in the line editor shown before import.

## Evidence

- AI receipt verification already assigns a canonical `categoryId` to every classified item.
- `ReceiptExtractionItem` persists only the category identity, which is the correct canonical relation.
- The review UI preserves `categoryId` when a line is edited, but `receiptReview()` does not receive a category name and therefore cannot render a human-readable category.
- Existing category names are owned by the category repository. Newly proposed categories are materialized before the extraction result is assembled.
- Fetching category labels independently in the browser would add a second asynchronous dependency and could briefly render opaque ids or stale labels. The extraction result can instead carry the exact category snapshot used by the reviewed lines.

## Decision

1. Keep `categoryId` as the canonical line relation; do not copy a mutable `categoryName` into every receipt item.
2. Extend `ReceiptExtractionResult.final` with a bounded `categories` array containing only canonical category descriptors referenced by `final.items`.
3. Build that snapshot from the category inventory captured for the AI request plus categories materialized during verification.
4. Pass the snapshot through both direct extraction and durable extraction assembly paths.
5. Render a visible category label in:
   - the compact receipt-line preview;
   - the Product section of the invoice-style line editor.
6. Do not show a synthetic category when a line has no `categoryId` (for example, deterministic local OCR without AI classification).
7. Preserve category identity through edits; the display is read-only in this task.

## Acceptance

- An AI-classified line with a canonical category id visibly shows the category name in the review list.
- Opening that line shows the same category in the line editor.
- The compact preview accessible name includes the category when present.
- Existing category ids and newly materialized categories both resolve to names.
- Unknown/fallback classification renders its canonical category name instead of an opaque id.
- Lines without category classification do not invent a category.
- Editing quantity, price, discount or description preserves the category id and visible category.
- No additional browser category lookup is required to render the completed extraction.
- Direct and durable extraction return the same category snapshot semantics.
- Existing receipt arithmetic, validation, OCR, AI, import, CSP and responsive behavior remain unchanged.

## Tests

- Unit: extraction assembly returns only referenced category descriptors and includes a newly materialized category descriptor.
- Unit/integration: direct and durable extraction paths pass the category inventory into final assembly.
- Browser: classified category is visible in compact preview and invoice editor on desktop/mobile; category-free lines remain category-free.
- Existing Browser E2E and quality gates remain green.

## Checks

- `pnpm quality`
- Browser E2E
- Security
- container smoke and architecture matrix
- CodeQL
- visual evidence publication when required

## Delivery

Target PR: #51 on `agent/feat-professional-inventory-redesign`.

No merge, release or deploy without explicit user approval.

## Status

In progress from branch head `ba07517bc60067c0fae75e59935662addf920049`. User-local commits are preserved.
