# PDF direct validation completion and compact source queue

## Request

PDF receipts must bypass OCR completely, display a compact processing queue, and show structured detected items with their category marker as soon as the durable WebAPI response is available. The queue must not occupy the ticket workspace with redundant counts, OCR copy, or text-heavy recovery controls.

## Decision

- A durable completed page exposes only its locally schema-validated structured interpretation in progress; it never exposes attachment data, response IDs, raw provider payloads, or PDF OCR text.
- The browser renders that completed interpretation as a provisional detected-line snapshot until the authoritative combined extraction arrives. Existing category IDs resolve through the category inventory; the terminal combined extraction remains the import authority.
- PDFs never render OCR preview, OCR count, OCR stage copy, or OCR recovery labels. Their stage language is limited to queue/AI/PDF validation states.
- The floating source disclosure owns processing state. Its detailed progress block and attachment-limit repetition are removed; rows remain collapsed by default and recovery actions are icon-only with accessible labels/tooltips.
- Durable job reads are revision-ordered. A late running response cannot overwrite a completed extraction, and the realtime source closes after terminal completion.

## Acceptance

1. A completed direct-PDF page with a valid remote interpretation visibly renders its items before or alongside final job assembly.
2. A terminal combined extraction renders the same category colour/name markers in the detected-item list.
3. No PDF queue row contains OCR text or an OCR disclosure, including an empty `0 productos OCR` state.
4. The queue has no persistent detailed progress card, attachment-limit copy, or automatic expanded file details.
5. Retry, cancel, manual review and diagnostic controls use icons while retaining explicit accessible names.
6. Progress never serializes attachment storage keys, MIME types, response IDs, or unvalidated provider payloads.
7. A stale durable read cannot replace a completed UI state.

## Tests

- Unit coverage for direct-PDF completed-progress serialization and redaction.
- Browser coverage for direct-PDF progressive items, category marker visibility, OCR-free queue content, compact collapsed details, and accessible icon controls.
- Durable runner/client integration coverage remains the authority for direct PDF WebAPI requests and terminal result persistence.
