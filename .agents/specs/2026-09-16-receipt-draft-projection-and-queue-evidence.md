# Receipt draft projection and compact queue evidence

## Request

After the browser module graph was restored, eight `🌐 Browser` shards still failed on the durable
ticket review branch. Diagnose each remaining failure, repair the product where the migration broke
a documented contract, and migrate only the specs whose expectations the current contract replaced.

## Evidence

- Run `35070806405` published the first readable failure text for seven of the eight shards through
  check-run annotations. Every failure mapped to a different contract, not to one shared cause.
- `basketra.spec.mjs:409` expected `2 tickets preparados` for two local-OCR captures and received the
  singular copy. `assembleCompletedPages` only projected per-capture drafts when `state.verifyWithAi`
  was true, so an unrelated pair of uploads was still combined into one ticket by a second
  `/api/v1/receipts/extract` call even though every page already owned a validated extraction.
- `receipt-auto-review-flow.spec.mjs:128` clicked a detected line and `#receipt-line-dialog` stayed
  hidden. `detectedItemsSnapshot` marks rows provisional while `state.extraction` is empty, and a
  provisional row carries no `data-receipt-action="edit"`, so the click never dispatched
  `basketra:receipt-edit-line`. The same combined-assembly branch left `state.extraction` unset for
  multi-capture local runs.
- `mobile-settings-receipts.spec.mjs:147` expected three `Completada` pills while the mocked durable
  job was still `running`. `completeBackgroundJob` also projected each page interpretation as its own
  draft, and the fixture's per-page interpretations carry `items: []`, so the terminal whole-ticket
  extraction (4 lines, 202,26 €) never reached the review surface.
- `receipt-durable-reload.spec.mjs:138` resolved `.capture-card__ocr-preview summary` but could not
  click it: the compact queue rule added `display: none` to the progressive OCR disclosure for every
  capture, although `appendProgressiveOcrEvidence` already skips direct PDF pages.
- `receipt-recovery-boundaries.spec.mjs:127` waited for `Entrada manual pendiente; la captura original
  se conserva` on a direct PDF page. `pagePartialText` returns no partial copy for a PDF page without
  a schema-validated interpretation, so the locator never resolved.
- `.agents/specs/2026-09-12-receipt-bundles-and-catalog-matching.md` states that page interpretations
  are projected into draft groups by capture and that unrelated uploads never participate in one
  arithmetic validation, while `.agents/specs/2026-09-12-pdf-direct-receipt-completion-ui.md` keeps
  the terminal combined extraction as the import authority and keeps OCR copy away from PDF rows.

## Scope

- `src/web/receipt-processing.js`: local assembly projects one draft per completed capture whenever
  more than one capture participates; a single capture keeps asking the server for the authoritative
  combined extraction, which preserves the defensive assembly-failure boundary.
- `src/web/receipt-review.js`: `applyJobDraft` projects one terminal durable extraction as a single
  draft group covering every capture of that job, reusing confirmed edits of an already active draft.
- `src/web/receipt-lifecycle.js`: `completeBackgroundJob` stores the terminal combined extraction on
  every page and delegates the projection to `applyJobDraft`; per-page interpretations remain
  progressive evidence only.
- `src/web/receipt-review.css`: the compact queue keeps the progressive OCR disclosure reachable for
  image captures.
- `tests/browser/mobile-settings-receipts.spec.mjs`: the durable job spec now asserts the in-flight
  stage before the terminal extraction and the completed stage after it.
- `tests/browser/receipt-recovery-boundaries.spec.mjs` and `tests/browser/components-gallery.spec.mjs`:
  the PDF row asserts the absence of image-only manual copy, and the page copy contract test carries
  the equivalent coverage for the image, silent-PDF and validated-PDF manual states.
- No API, schema, dependency or server change.

## Decisions

1. Capture count decides the local projection: one capture still round-trips through the server so the
   combined extraction stays the import authority and the existing assembly-failure boundary keeps its
   meaning, while several captures never share arithmetic validation.
2. A durable job is one bounded session over one physical receipt, so its terminal extraction becomes
   one draft group with all of its captures as evidence instead of one draft per page. Duplicating the
   combined lines into per-page drafts would import the same ticket several times.
3. Progressive per-page interpretations keep rendering while the job runs; only the terminal
   extraction feeds the review surface. This keeps the PDF rule that a completed page exposes just its
   locally schema-validated interpretation.
4. The compact queue hides redundant progress copy but never hides evidence an operator must open, so
   the progressive OCR disclosure stays reachable for images and remains impossible for PDFs because
   the renderer skips them.
5. Coverage moved instead of disappearing: the image manual-entry copy is now asserted directly
   against `pagePartialText` for the image, silent-PDF and validated-PDF states.

## Acceptance

- Two local-OCR captures report `2 tickets preparados`, keep one editable line each, and their
  detected rows open the line modal.
- One local-OCR capture still reports the singular prepared copy and still surfaces an assembly
  failure as `Las páginas completadas se conservan`.
- A completed durable job over three captures reports one prepared ticket with the combined lines,
  declared total, retailer and store, and its confirm payload keeps every page.
- The progressive OCR disclosure inside an opened queue row is visible, expandable and shows its OCR
  text for an image capture, while a PDF row renders no OCR disclosure at all.
- A direct PDF page in manual review shows no image-only manual copy, and the page copy contract test
  pins the image, silent-PDF and validated-PDF manual strings.
- `pnpm quality` passes, including the browser changed-code coverage gate.

## Rollback

Revert the assembly capture-count condition, `applyJobDraft`, the `completeBackgroundJob` projection,
the queue OCR rule and the migrated spec assertions. Local multi-capture runs combine into one ticket
again, a terminal durable job projects empty per-page drafts, and the queue hides the progressive OCR
disclosure.
