# Local Tesseract OCR and Mobile Receipt Review

## Request

Provide a free, local, low-memory OCR engine for receipt photographs on Raspberry Pi so extraction does not require an external AI provider.

The receipt review must use editable product rows instead of a raw textarea, display money in euros rather than minor units, and reuse a mobile swipe interaction across receipt rows and shopping-list items.

## Evidence

- Image OCR previously used only the optional OpenAI-compatible provider.
- Without that provider, the UI reported that OCR was not configured.
- Production is Alpine Linux on AMD64 and ARM64 with a 192 MiB memory limit.
- Repository policy forbids resident OCR workers and requires bounded, lazy work.
- Tesseract 5 and Spanish language data are available as Apache-2.0 Alpine ARM64 packages.
- The existing browser flow exposed backend integer minor units directly as cents and required correcting unstructured text.
- The shopping list and receipt review both need touch actions, but every gesture requires an equivalent simple pointer and keyboard action.
- The requested interaction has two progressive left-swipe thresholds: reveal actions first, then delete when the user deliberately continues through the destructive threshold.

## Decision

1. Install native Tesseract 5 and Spanish language data in the runtime image.
2. Run it as an ephemeral child process only during OCR.
3. Limit it to one thread, one concurrent recognition, bounded timeout and bounded output.
4. Use fixed arguments without a shell and parse TSV into ordered text plus confidence.
5. Use local OCR for JPEG/PNG; retain optional multimodal AI for PDFs and optional verification.
6. Expose OCR and AI capability metadata so the UI does not imply AI is required.
7. Preserve original evidence and manual recovery behavior.
8. Replace the receipt textarea with editable rows for description, quantity, unit price and line total.
9. Keep money authoritative as integer minor units in the backend while parsing and formatting euros through one shared browser module.
10. Reuse one progressive swipe controller for receipt rows and shopping-list rows.
11. A short left swipe physically moves the row and leaves edit/delete actions visible.
12. Continuing the left swipe past the destructive threshold changes the rail to a full red `Suelta para eliminar` state and deletes on release.
13. Swipe deletion immediately offers `Deshacer`; receipt rows restore in memory at the original index, while shopping-list items are recreated through the canonical API and restored to their original ordering and completion state.
14. A right swipe completes a shopping-list item.
15. Visible action buttons, an explicit action-menu button and Escape support remain available for keyboard, assistive technology and simple pointer input. The explicit delete button retains confirmation; only the deliberate full-swipe path deletes directly and remains recoverable through Undo.
16. Generate the container OCR smoke image deterministically during the build, run real Spanish OCR under a 128 MiB virtual-memory ceiling and remove image-generation dependencies before completing the runtime layer.
17. Publish Playwright screenshots, GIFs and videos directly in the PR through temporary GitHub assets; do not commit generated media.
18. The visual evidence must include the revealed-action state and the post-delete Undo state for both shopping-list and receipt rows.

## Acceptance

- JPEG/PNG processing works without AI URL, model or API key.
- Timeout, abort, output limit, process failure, empty text and unsupported PDF have stable errors.
- OCR content, filenames and paths are never logged.
- Receipt products are editable as structured rows.
- Prices and totals are entered and displayed as euros, including values such as `0,20 €`; cents are not exposed as the UI unit.
- Receipt rows and shopping-list items use the same progressive swipe interaction contract.
- A short left swipe reveals actions without mutating data.
- A full left swipe deletes on release and exposes a working `Deshacer` action.
- Shopping-list Undo restores item content, completion state and relative ordering through canonical APIs.
- Receipt-row Undo restores all edited euro values and the original row position.
- Right swipe completes a shopping-list item.
- Every gesture has an equivalent visible button action.
- Playwright covers local OCR success, editable rows, euro parsing, import, OCR failure, preserved captures, manual recovery, short-swipe reveal, right-swipe completion, full-swipe deletion, Undo, keyboard close and persistent deletion.
- Container smoke executes real Tesseract Spanish recognition below 128 MiB virtual memory.
- Quality, security, CodeQL, Trivy, resource, AMD64 and ARM64 checks pass.
- The PR directly renders the four swipe threshold screenshots, GIFs and links to full videos for the final head.

## Tests

- Unit coverage for the local OCR provider, bounded process execution, TSV parsing and error mapping.
- Receipt-pipeline integration coverage with local OCR and optional AI verification boundaries.
- Ten deterministic mobile Chromium flows with no retries, including OCR success/failure, photo upload recovery and progressive swipe interactions.
- Browser assertions for short reveal, full delete, Undo restoration, right completion, explicit action button and Escape behavior.
- Container smoke with real `spa` recognition from a generated synthetic receipt.
- Native image builds for `linux/amd64` and `linux/arm64`.
- CodeQL, repository security policy, dependency audit and Trivy scanning.

## Checks

The final PR head must pass the canonical Pull Request Quality workflow, including Quality, Security, Browser E2E, container smoke, AMD64 and ARM64 jobs, plus CodeQL and direct visual-evidence publication. Run URLs and the validated head are recorded in the PR rather than in this versioned task spec.

## Risks

- OCR uses transient CPU/RAM: one process, one thread, one concurrent recognition, timeout and output caps bound it.
- Poor photos reduce accuracy: structured correction, confidence, original evidence and manual fallback remain.
- Native packages enlarge the image: SBOM, Trivy and multi-architecture builds remain mandatory.
- Local PDF rasterization is out of scope; configured provider or manual entry remains available.
- Swipe gestures can be undiscoverable: explanatory copy, visible action-menu buttons and direct PR evidence make the interaction discoverable.
- Destructive gestures can cause mistakes: the destructive threshold is substantially larger than the reveal threshold, displays an explicit red release state and provides Undo.

## Rollback

Revert the PR. No schema or persisted-data migration is involved.

## Delivery

Branch `agent/feat-local-tesseract-ocr`; PR #9. No merge, release, deployment, GHCR publication or Raspberry mutation.

## Status

- Reconnaissance: complete.
- Specification: complete.
- Implementation: complete.
- Refactor: complete.
- Validation: complete on the implementation head; final documentation-head validation required.
- Visual evidence: automated and must be regenerated for the final head.
- Delivery: PR remains open; pending final green checks and explicit merge approval.
