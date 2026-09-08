# Minimal receipt analysis UI

## Request

Redesign the receipt-analysis experience around the user-approved prototype:

- mobile-first and deliberately minimal;
- uploaded images/PDFs live behind a compact floating source/progress control fixed to the right edge instead of occupying the body;
- the always-visible control shows only minimal count/state; opening it exposes per-file loading/progress, recoverable errors, retry/manual recovery and preview;
- a visible `×` action cancels the whole analysis while preserving already persisted captures/OCR evidence;
- a compact floating `+` action exposes three entry paths: AI/file upload, Manual and Scan/photo;
- the body is primarily the progressively detected receipt lines; detailed progress is kept inside the expandable source control instead of consuming body space;
- the existing preview, editable review, line validation, total validation and final import flow remain available.

The visual direction was explicitly approved before implementation. The launcher/download-popover screenshot supplied by the user is a behavioral reference for the compact dropdown, not a request to copy its branding.

## Evidence and current context

- Root `AGENTS.md` requires dependency-free runtime, no polling, one canonical frontend HTTP client and regression coverage.
- Root `spec.md` requires camera/gallery/previews and OCR evidence to remain recoverable when AI is unavailable, while configured receipt analysis always continues through durable AI verification; it also requires 320 px support, safe-area handling, accessible alternatives and preserved evidence.
- The current frontend is framework-free HTML/CSS/ES modules under `src/web`.
- `modern.css` owns semantic palette, spacing, radius, touch and motion tokens.
- `ui.js` owns the icon family and receipt-line renderer.
- `receipt-state.js` owns receipt UI state; durable job identity is persisted through `state.js`.
- `receipt-capture.js` owns capture rendering and per-capture recovery actions.
- `receipt-lifecycle.js` owns global/per-page processing progress and durable-job synchronization.
- `receipt-review.js` owns editable review, validation and import preparation.
- `receipts.js` already composes receipt-specific progressive-disclosure and sticky review UI.
- Playwright is already the browser authority; receipt-specific suites cover durable jobs, cancellation, responsive review and visual evidence.
- No Storybook or component catalog is present. Existing semantic tokens/components remain the authoritative visual source.

## Decision

### Information architecture

The Tickets view becomes three layers:

1. **Floating source/progress control** — a small disclosure fixed at the right edge, vertically stacked with the floating `+`. Its collapsed state shows only source count and semantic aggregate state. Opening it reveals detailed global progress, uploaded sources, per-source state/recovery and the destructive cancel-all action.
2. **Primary body** — progressively detected line summaries without a permanent progress card. This remains the dominant mobile surface while OCR/AI is running.
3. **Review disclosure** — when a combined result exists, the existing preview/edit/validate/import workflow remains available behind a concise “Vista previa y validación” disclosure instead of automatically occupying the whole page.

The source queue and review disclosure are separate concepts. Closing a disclosure never cancels work. The visible `×` in the queue is explicitly named “Cancelar todo el análisis” and performs cancellation only.

### Floating add action

A single floating `+` button opens a small speed dial:

- **IA**: choose existing image/PDF files. There is no AI enable/disable option in the receipt UI; configured AI verification is always used.
- **Manual**: open the existing focused receipt-line modal as a new draft. Cancel/close/Escape discards that unsaved draft and returns to the minimal workspace.
- **Scan**: invoke the existing rear-camera input and use the same implicit configured-AI path after capture.

The speed dial must close after an option is chosen, on `Escape`, on outside interaction, and when leaving the Tickets view.

### Progressive line stream

A compact derived list is rendered from existing page state only:

- prefer a page’s structured result when available;
- otherwise show progressive deterministic OCR items;
- once the combined extraction is available, use the combined review model;
- mark in-progress/provisional state without presenting it as persisted evidence;
- do not create a second receipt model or persistence path.

Temporary cross-page overlap may exist before final assembly; copy must make the provisional nature clear. Final combined review remains authoritative for import.

### Responsive behavior

Mobile is the primary layout.

- At 320–430 px the source/progress trigger and `+` remain fixed at the right edge above bottom navigation/safe area, each preserving at least a 44 × 44 CSS px target.
- The collapsed source/progress trigger is always visible and minimal; its panel expands inward/upward without page-level horizontal scrolling.
- Detailed global/file progress lives inside that panel and therefore never consumes a persistent body row.
- The speed dial remains above bottom navigation and safe-area insets and must not cover the review CTA.
- On desktop the same queue becomes a bounded top-right popover; the functional flow is unchanged.
- No hover-only behavior.

### Accessibility

- Native `button`, `label`, `details` and `summary` semantics are preferred.
- Queue trigger exposes expanded/collapsed state through native disclosure semantics.
- Cancel-all is a separately named destructive button; the glyph alone is decorative.
- File progress retains progressbar semantics and user-readable stage text.
- Dynamic global/file status remains announced through existing polite live regions without duplicating noisy announcements.
- Floating actions have visible text in the expanded dial and accessible names in all states.
- `Escape` closes transient UI without cancelling work.
- Touch targets remain at least the existing `--touch` target; focus remains visible; `prefers-reduced-motion` is respected.
- Review focus/virtual-keyboard protection remains intact.

## Scope

### In scope

- Tickets/receipt-analysis frontend composition and responsive styling.
- Progressive detected-line presentation derived from current receipt page/result state.
- Compact queue disclosure and queue interactions.
- Floating add speed dial using existing file inputs/manual-line action.
- Preserve and adapt current preview/review/validation/import interactions.
- Browser/static tests for happy path, error/retry, cancel, keyboard, mobile/desktop, 320 px overflow and visual evidence.
- Task spec and PR delivery evidence.

### Out of scope

- Backend/API/database changes.
- New AI endpoints or provider behavior.
- New persistence format or offline receipt writes.
- New framework/component/icon dependency.
- Changes to receipt extraction algorithms, overlap elimination or canonical validation rules.
- Merge, release or deploy.

## Planned files

Expected production files:

- `src/web/index.html`
- `src/web/receipts.js`
- `src/web/receipt-capture.js`
- `src/web/receipt-review.js` only if opening behavior needs a focused adjustment
- `src/web/receipt-review.css`
- `src/web/modern.css` only for route-level layout rules that belong to the global tokenized stylesheet

Expected tests:

- new `tests/browser/receipt-analysis-minimal-ui.spec.mjs`
- affected existing receipt browser specs where assertions intentionally change
- static/unit coverage only if deterministic helpers are extracted or changed

The actual diff must remain smaller if existing components can satisfy the behavior without touching every planned file.

## Acceptance criteria

1. The Tickets body no longer permanently displays large capture/upload cards as primary content.
2. A compact always-visible disclosure fixed at the right edge reports source count/state minimally and opens detailed progress/source information on mobile and desktop.
3. Queue rows expose meaningful pending/processing/completed/error/cancelled state, preview where supported and existing recovery/retry actions.
4. A queue-header `×` cancels the whole analysis; closing the queue itself does not.
5. Cancel-all preserves captures and already durable OCR/completed evidence exactly as the existing cancellation contract requires.
6. A single floating `+` opens exactly three visible paths: IA, Manual and Scan.
7. The receipt UI exposes no AI verification toggle; when AI is configured, file/camera analysis always uses it. Missing/failing AI preserves uploaded evidence and available local OCR for recovery/manual review.
8. The body progressively shows detected line summaries before final assembly and switches to the combined model when available.
9. Aggregate progress remains always visible through the compact floating source control while work is active; completed/total and detailed error/cancel information are available after expansion.
10. Automatic extraction no longer auto-expands the full review editor; a concise review disclosure/CTA remains visible after final assembly.
11. Opening review preserves capture preview only when capture evidence exists, plus editable rows, retailer/store fields, line validation, total validation and confirm/import.
12. Manual entry opens the focused line modal, exposes Cancel/close, shows no capture selector when there are no captures, and discards the unsaved draft on cancellation.
13. At 320, 390/430, 768 and desktop widths there is no unintended horizontal overflow, clipped expanded queue, hidden floating source/progress control, hidden FAB or bottom-navigation collision.
14. Keyboard users can operate queue, speed dial, review and cancellation; `Escape` closes transient queue/dial state without cancelling.
15. Existing durable AI/SSE behavior remains polling-free and uses current state owners.
16. No new dependency, API contract, database migration or persistent receipt source of truth is introduced.
17. Changed deterministic frontend logic has meaningful regression coverage; repository changed-code coverage gates are not weakened.
18. `pnpm quality`, required Browser shards/visual evidence, resource checks when triggered, CodeQL and relevant CI are green on the exact PR head.

## Test plan

### Browser

- 390 px: queue closed/open, running OCR/AI, progressive lines, file error and retry.
- 320 px: queue and speed dial fit without horizontal overflow; focus/labels remain visible.
- 430 px: cancel-all preserves captures and closes/updates transient state correctly.
- Desktop: queue behaves as bounded popover and body stays minimal.
- Keyboard: trigger, speed-dial actions, `Escape`, review disclosure and destructive action naming.
- AI configured and not configured: no AI toggle is rendered; configured AI is selected implicitly and unavailable/failing AI preserves recoverable evidence.
- Manual path: focused line modal opens, Cancel/close discards the draft, successful save appears in the compact detected-items body, and no empty capture preview is rendered.
- Completed extraction: review remains collapsed until requested; preview and final validation/import still work.

### Regression

Existing receipt durable-job, reload, cancellation, line-editor, discount, mobile-toolbar and sticky-focus suites must remain green or be updated only where the approved presentation intentionally changes.

## Risks

- Moving capture cards into a transient queue can hide recovery information. Mitigation: aggregate error/count state remains visible in the trigger/global progress, and errors keep direct retry inside the opened queue.
- The `×` glyph conventionally means close. Mitigation: its accessible name and tooltip explicitly say “Cancelar todo el análisis”; closing uses disclosure semantics/`Escape`.
- Progressive page-level items can include temporary overlap before final assembly. Mitigation: label the stream provisional and replace it with the combined model when available; never persist from the stream.
- A floating action can obscure bottom content on mobile. Mitigation: use existing safe-area/navigation tokens and verify 320/390/430 px screenshots.
- A continuously rotating progress affordance can distract or affect motion-sensitive users. Mitigation: animate only during real work, use a short gradient arc rather than a full ring, stop immediately on complete/error/idle, keep the inner icon stable, and honor `prefers-reduced-motion` with the same arc frozen in place.
- The error pulse must not become alarming or rely on motion/color alone. Mitigation: use a slow 2.2 s perimeter pulse, preserve the existing textual error state/ARIA label and status dot, and render a static error border under reduced motion/forced colors.
- Existing tests currently expect review auto-expansion and a visible “Cancelar procesamiento” button. Those assertions must be migrated to the accepted queue/review interaction without weakening behavioral coverage.
- Editing provisional OCR rows would create a competing mutable source while final assembly can still replace them. Mitigation: keep provisional rows read-only and enable row actions only after the combined/manual item model becomes canonical.

## Rollback

Frontend-only and reversible. Reverting the focused commits restores the prior permanent capture sections and review auto-expansion. No migration, API version change or data repair is required.

## Checks and delivery

Before handoff:

- inspect diff for unrelated work and secrets;
- run/verify repository quality gates;
- inspect Browser visual artifacts for every affected viewport/state;
- inspect console/network behavior in representative receipt flows;
- create a normal non-draft PR with what/why/impact/tests/risks;
- inspect CI on the exact head and fix evidence-based failures;
- perform final request/spec/acceptance review after CI is green.

## Follow-up device feedback

- The explanatory sentence below “Análisis de ticket” is removed; the screen title stands on its own.
- The empty-stream sentence “Añade un ticket con +. Los productos aparecerán aquí a medida que se detecten.” is removed entirely; the zero-item state remains visually empty apart from the section heading/count and available floating actions.
- File/progress state is no longer a full-width header row or sticky body card. A small always-visible right-edge control, aligned with the compact `+`, owns aggregate source/progress state and expands for detailed progress, files and recovery actions.
- The processing affordance uses a partial rotating gradient arc inspired by a conventional spinner; it must read as motion at a glance and never resemble a complete static circle.

## Approved responsive receipt-summary redesign

The user approved both the desktop and mobile prototypes as the next visual layer for the same PR. This does not turn the detected stream into a literal paper receipt. The receipt metaphor is informational only; products remain independent rows.

### Additional UX contract

- Show the currently recognized retailer prominently when one canonical candidate is available; show a neutral unresolved/multiple-retailer state otherwise.
- Show a live calculated total derived from the same detected/review item model already rendered by the receipt flow. Do not introduce a second receipt or money calculation owner.
- Surface explicit discounts without inventing promotion data. Discount count/details come only from the existing typed item discount model and existing unassigned-discount evidence.
- Preserve independent product rows with description, quantity/unit-price context and line total.
- Once the combined/manual item model is canonical, each product row is operable in place: touch users can swipe to reveal Edit/Delete and every viewport exposes a row action control for the same actions. Edit opens the existing receipt-line modal; Delete reuses the existing undoable deletion owner. Provisional OCR/page rows remain read-only so later assembly cannot overwrite user edits silently.
- Desktop progressively enhances into a two-column workspace: product stream as the primary column, compact ticket summary as the secondary sticky column, plus a top analysis/retailer strip and live-total surface.
- Mobile remains one column: compact retailer/analysis state first, independent product rows next, then a concise summary with discounts and provisional/final total.
- Empty state uses a restrained empty-ticket visual placeholder but does not restore the previously rejected explanatory sentence or other redundant body copy.
- Existing floating source/progress disclosure and floating add action remain the recovery/input owners and must stay reachable above navigation/safe areas.
- Existing review/edit/validate/import disclosure remains authoritative for corrections and confirmation.

### Additional acceptance criteria

19. A recognized retailer name is shown from existing extraction/retailer-candidate state without fabricating confidence or store identity.
20. The live total updates from the currently rendered detected/review items and uses integer minor-unit values only.
21. Explicit item discounts and existing unassigned discounts are represented in the summary; no discount is inferred from description text alone.
22. At desktop widths the product stream and summary use the approved two-column information hierarchy without changing the functional flow.
23. At mobile widths the same information reflows to one column, with the summary following the detected products and no horizontal overflow at 320/390 px.
24. The zero-product state shows a visual empty-ticket affordance without the removed “Añade un ticket…” explanatory copy.
25. Product rows remain individually scannable and do not become a literal paper-ticket rendering.
26. Existing queue/retry/cancel/manual/review/import behavior and accessibility contracts remain intact.
27. Canonical detected rows support Edit/Delete without opening the full review: mobile swipe and the row action control reveal the same actions, Edit reuses the existing line modal, and Delete reuses the existing undoable deletion owner.
28. Editing or deleting a canonical row updates the visible row and live calculated total immediately from the same `state.items` model; provisional OCR rows expose no edit/delete controls.
29. Row actions are keyboard-operable, have explicit accessible names, preserve the existing touch-target contract, and work at both 390 px and desktop widths.
30. The collapsed floating source/progress control shows a non-blocking rotating partial gradient arc (roughly one third of the circumference, never a full ring) only while aggregate state is `working`; completed/idle/error states do not use that spinner. The inner receipt icon and count remain stationary. With `prefers-reduced-motion: reduce`, the same partial arc remains visible but static.
31. Aggregate source error keeps the familiar receipt glyph and uses a slow red perimeter pulse instead of replacing the icon. The accessible summary still reports the error and recovery actions remain inside the expanded queue.

## Validation evidence

- CI aggregation evidence on `f24c3c736c6175fa17c359727c9b9a005f92a6a4`: all 56 Browser coverage shard artifacts were present and surfaced Browser jobs were successful, yet Pull Request Quality failed again after shard completion. The remaining post-shard `browser-coverage` job still had a 1-minute envelope while downloading/merging all 56 artifacts. Its envelope is raised to 2 minutes without changing the aggregate coverage command or Playwright's 45-second execution budget; the timeout contract test now scopes Browser E2E and Browser coverage separately.
- Container CI evidence on `cb42769aa46fc9087781051f00d6a9c5d178f23d`: linux/amd64 completed build, SBOM/provenance generation, build-record upload and every cleanup step successfully, then GitHub reported the job as cancelled at the 1-minute envelope. An earlier run showed the same post-success cancellation pattern for Container smoke. Both container envelopes are therefore 2 minutes; build/smoke commands and resource budgets are unchanged.
- Browser shard evidence on `8c56b9be8b087edb0e6ff8d6e962fa475f1a1c59`: Browser 18/56 ran 3 tests in 29.8 s, uploaded coverage and visual evidence, completed all post-job cleanup steps successfully, then GitHub reported the job as cancelled at the 2-minute envelope. The Browser shard envelope is raised to 3 minutes while the Playwright command remains hard-capped at 45 s; this changes only runner setup/teardown allowance, not test execution budget.
- Pull Request Quality run `34170520439` passed on production head `17b3d6ad78dae523edee34da3298ff6462b0606d` after one infrastructure-only rerun of Browser 6/56; that shard had already completed both tests and every job step successfully before GitHub marked the first attempt cancelled.
- CodeQL Advanced run `34170520574` passed all nine matrices on the same production head.
- Browser changed-code coverage passed after explicit guard-branch regressions were added; no threshold or gate was weakened.
- Exact-head visual artifacts reviewed:
  - `basketra-browser-evidence-49`: manual modal at 390 px exposes ×, Cancel and Save, with no capture selector/preview; cancelling returns to the minimal workspace.
  - `basketra-browser-evidence-51`: floating IA / Manual / Scan actions fit at 390 and 1280 px without collision or clipping.
  - `basketra-browser-evidence-48`: progressive source queue exposes file state, global progress and detected items while processing.
  - `basketra-browser-evidence-39`: unrelated receipt discount visual regression remained clean.
- 320/390/768/1280 responsive contracts and horizontal-overflow assertions pass in Playwright.
- PR #63 is non-draft, mergeable and contains no API, database, dependency or persistence-format change.

## Status

- [x] Recon complete against `main` at `6fc25b3af3c26e59fa905bb4c672a438a630120f`.
- [x] User-approved prototypes translated into executable acceptance criteria.
- [ ] Responsive receipt-summary follow-up implementation.
- [ ] Updated local/CI-equivalent validation.
- [ ] Updated Browser visual review for mobile and desktop summary layouts.
- [x] PR created.
- [ ] CI green on the new exact head.
- [ ] Final request/spec/diff/visual review complete for the approved responsive redesign.
