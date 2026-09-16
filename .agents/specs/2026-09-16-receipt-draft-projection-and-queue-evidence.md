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

# Second round: queue expansion, confirm feedback and boot-synchronised specs

## Request

After the first round, a diagnostic workflow re-ran the seven originally failing tests plus the
shard-27 candidates: five passed and four still failed. Repair the remaining product regression and
migrate the specs whose expectations or timing the current contract replaced.

## Evidence

- Diagnose run `35076301097` published the four remaining failures through check-run annotations, and
  a temporary probe spec reproduced the retailer wiring in isolation.
- `mobile-settings-receipts.spec.mjs:181` expected `#receipt-state` to contain `Ticket importado`.
  `confirmReceipt()` clears the analysis status and reports the import through the toast
  (`Ticket confirmado`, or `Ticket importado. Continúa con el siguiente ticket.` when drafts remain),
  which is what every other confirm spec asserts. Everything upstream of that line passed: three
  in-flight pills, retailer `ALCAMPO`, store `ALCAMPO ALMERIA`, declared total `20226`, four items and
  a confirm payload keeping `ai.pages` with three entries.
- `receipt-recovery-boundaries.spec.mjs:130` could not find `Volver a analizar con IA` after
  `useManualReview`. `renderCaptureProgress` hardcoded `details.open = false`, so the re-render caused
  by the manual transition collapsed the row and hid its recovery actions, even though
  `state.expandedCaptureKey` is still written by the disclosure toggle, set by `failBackgroundJob` and
  `recordAiFailure`, and cleared when the AI retry succeeds.
  `.agents/specs/2026-08-19-receipt-auto-review-flow.md` keeps processing/recovery details collapsed by
  default *except* for active or failed work that needs user attention.
- `changed-code-boundaries.spec.mjs:124` and `changed-code-residuals.spec.mjs:82` dispatched synthetic
  `input`/`change` events immediately after `page.goto('/tickets')`. The probe measured both orders:
  installing the workspace from the spec produced zero suggestion options, `aria-expanded="false"` and
  no store request, while waiting for the application-created `#receipt-retailer` produced the
  suggestion option and the store request. `initReceipts()` installs and binds in one task, so the
  spec-installed field satisfied `toBeAttached()` before `bindEvents()` ran. On `main` the equivalent
  `toBeVisible()` wait implicitly synchronised with boot; migrating it to `toBeAttached()` (required
  because `#receipt-review-panel` is now `display: none`) removed that synchronisation.
- The first `Pull Request Quality` run for this branch (`35079435382`) was cancelled by the
  pre-existing one-minute job budget of `✅ Changed coverage` in `ci.yml`, which is identical on
  `main` and was not modified here. `scripts/check-diff-coverage.mjs` only takes its heavy path when
  one of the five pinned production files changed against the pull request base, which this branch
  inherits from the durable ticket review work (`src/receipts/service.ts`, `src/operations/gateway.ts`).
  That path re-runs the unit, integration and end-to-end suites serially under coverage and measured
  34 s locally, so the job sits close to its budget and runner variance decides the outcome. The
  fifteen browser shards that ran before the cancellation all passed, including the shard that owns
  the previously failing retailer and receipt specs.

## Scope

- `src/web/receipt-capture.js`: `renderCaptureProgress` restores `details.open = state.expandedCaptureKey === key`.
- `tests/browser/mobile-settings-receipts.spec.mjs`: the whole-ticket import asserts the cleared
  analysis status and the `Ticket confirmado` toast.
- `tests/browser/changed-code-boundaries.spec.mjs` and `tests/browser/changed-code-residuals.spec.mjs`:
  wait for the application-created retailer field instead of installing the receipt workspace.
- `tests/browser/receipt-ai-background-job.spec.mjs`: the cancelled row uses the tolerant disclosure
  pattern the other receipt specs already share, so a row that is legitimately open is not collapsed
  by the click.
- No API, schema, dependency or server change.

## Decisions

6. Queue rows stay collapsed by default; only an explicit operator expansion or a failure that needs
   attention keeps a row open across re-renders. Hardcoding the collapsed state turned
   `state.expandedCaptureKey` into dead state and hid recovery actions right after the transition that
   makes them relevant.
7. A spec that drives synthetic events must wait for the application to wire the workspace. Observing
   the application-created field is a reliable boot barrier because installation and binding happen in
   the same task; installing the workspace from the spec wins that race and leaves the listeners
   unbound without any observable error.
8. Confirm feedback lives in the toast, so import specs assert `#toast-message` instead of the
   analysis status, which the confirm flow clears by contract.

## Acceptance

- A PDF page in manual review keeps its expanded row and exposes `Volver a analizar con IA`.
- A completed or cancelled queue without a failure that needs attention keeps every row collapsed, as
  `receipt-ai-background-job.spec.mjs` and `mobile-settings-receipts.spec.mjs` still assert.
- The three-capture whole-ticket import clears `#receipt-state` and toasts `Ticket confirmado`.
- The retailer specs render one suggestion for `AL`, fill `ALCAMPO` and one store option after
  selecting it, and issue the `retailer=EMPTY` store request.
- `pnpm quality` passes, including the browser changed-code coverage gate.

## Rollback

Revert the `details.open` expression, the toast assertion, the boot barriers and the tolerant
disclosure click. Rows collapse on every re-render and hide recovery after any transition, the import
spec expects status copy that no longer exists, and the two retailer specs race `initReceipts()` again.

# Third round: aggregate browser coverage of the migrated review

## Request

With every browser shard green for the first time, `Pull Request Quality` reached the aggregate
changed-code browser coverage gate (`🌐 Browser coverage`), which had been skipped while shards
failed. It reported 43 uncovered changed lines, branches and functions. Repair the gap without
relaxing the gate.

## Evidence

- A temporary workflow downloaded the 184 shard coverage payloads (109 MB) from run `35080943278`,
  merged them exactly like the `browser-coverage` job and republished the gate output as a check-run
  annotation, because job logs and artifacts cannot be downloaded from the diagnosis environment.
- The uncovered set is the defensive surface of the migrated review: the line editor's
  empty-description rejection and its session guard (`app.js:299,301-306`), the missing
  `data-item-index` fallback (`app.js:338`), the focus fallback when no detected row remains
  (`app.js:398`), the review `change` listener that refreshes the compact category summary
  (`app.js:524-530`), the plural AI validation copy (`operations.js:257`), the legacy sticky-summary
  branch (`receipts.js:107`), the evidence selector fallbacks
  (`receipts.js:156,162,178,179,183,198`) and the review, keyboard and evidence event guards
  (`receipts.js:670,689,691,699-703,713,715-719`).
- `app.js:398` also carried an unreachable branch: the editor session always stores a return-focus
  selector, so `returnFocusSelector ? document.querySelector(returnFocusSelector) : null` could never
  take the `null` side and no test could ever cover it.
- Driving the plural concurrency copy exposed a product bug: `operations.js` built the plural by
  appending `es` to the accented singular, so any concurrency above one rendered
  `3 validaciónes de ticket a la vez`.
- The legacy sticky branch also needs `#confirm-receipt` in the document: the compact summary adopts
  that button, so removing `#receipt-live-summary-actions` without moving the button back makes
  `syncStickyReviewSummary()` stop at its `!confirm` guard instead of reaching the legacy branch.

## Scope

- `tests/browser/receipt-editor-evidence-boundaries.spec.mjs` (new): five boundary tests that drive
  the editor guards, the category change listener, the evidence renderer fallbacks, the legacy sticky
  branch and the review/keyboard/evidence event guards through the listeners a user reaches.
- `tests/browser/ai-provider-diagnostics.spec.mjs`: the provider summary also renders the plural copy
  for three parallel ticket validations.
- `src/web/app.js`: the focus fallback drops the unreachable ternary; the trigger element stays the
  only fallback and the invariant is documented at the call site.
- `src/web/operations.js`: the provider summary chooses between `validación` and `validaciones`
  instead of appending `es` to the accented singular.
- No API, schema, dependency or server change.

## Decisions

9. Changed UI code is exercised instead of excused: every uncovered path keeps its behavior and gains
   a boundary test, so the aggregate gate keeps measuring real coverage rather than being relaxed.
10. An unreachable defensive branch is removed instead of being preserved behind a state the product
    cannot produce; the surrounding invariant is documented where the selector is consumed.
11. Boundary tests wait for the application-created workspace before driving events, reusing the boot
    barrier from the second round so they cannot pass for the wrong reason.
12. A boundary test that drives a user-visible string also pins it: the plural concurrency copy is now
    asserted in both directions, which is what caught the misspelling.

## Acceptance

- `🌐 Browser coverage` passes over the aggregate of every shard.
- The five new boundary tests pass in the compact viewport: the editor rejects an empty description,
  keeps focus, restores the line on cancel, falls back to the first line and to the trigger focus,
  refreshes the compact category summary in both directions, renders evidence with and without
  captures, and leaves the review model untouched when a guard stops an event.
- The provider summary reports `1 validación de ticket a la vez` and
  `3 validaciones de ticket a la vez`.
- `pnpm quality` passes locally.

## Rollback

Revert the new boundary spec, the plural-copy assertions, the concurrency noun fix and the
focus-fallback simplification. The
aggregate browser coverage gate reports the same 43 uncovered changed lines, branches and functions,
and `🌐 Browser coverage` fails again as soon as every shard passes.
