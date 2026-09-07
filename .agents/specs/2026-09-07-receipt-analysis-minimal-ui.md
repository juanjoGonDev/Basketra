# Minimal receipt analysis UI

## Request

Redesign the receipt-analysis experience around the user-approved prototype:

- mobile-first and deliberately minimal;
- uploaded images/PDFs live in a compact dropdown queue instead of occupying the body;
- the queue exposes per-file loading/progress, recoverable errors, retry/manual recovery and preview;
- a visible `×` action cancels the whole analysis while preserving already persisted captures/OCR evidence;
- a compact floating `+` action exposes three entry paths: AI/file upload, Manual and Scan/photo;
- the body is primarily the progressively detected receipt lines plus a small always-visible global progress indicator;
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

1. **Compact source queue** — a disclosure trigger near the receipt heading showing file count and aggregate state. Opening it reveals uploaded sources, per-source state/recovery, upload controls/options and the destructive cancel-all action.
2. **Primary body** — a compact global progress strip followed by progressively detected line summaries. This is the dominant mobile surface while OCR/AI is running.
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

- At 320–430 px the queue panel uses the available width below its trigger, never creates page-level horizontal scrolling and remains reachable above bottom navigation/safe area.
- The global progress strip remains compact and sticky enough to keep status visible without hiding focused controls.
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
2. A compact disclosure reports the number/state of uploaded image/PDF sources and opens the queue on mobile and desktop.
3. Queue rows expose meaningful pending/processing/completed/error/cancelled state, preview where supported and existing recovery/retry actions.
4. A queue-header `×` cancels the whole analysis; closing the queue itself does not.
5. Cancel-all preserves captures and already durable OCR/completed evidence exactly as the existing cancellation contract requires.
6. A single floating `+` opens exactly three visible paths: IA, Manual and Scan.
7. The receipt UI exposes no AI verification toggle; when AI is configured, file/camera analysis always uses it. Missing/failing AI preserves uploaded evidence and available local OCR for recovery/manual review.
8. The body progressively shows detected line summaries before final assembly and switches to the combined model when available.
9. Global progress remains visible in a compact form while work is active and exposes completed/total plus meaningful error/cancel state.
10. Automatic extraction no longer auto-expands the full review editor; a concise review disclosure/CTA remains visible after final assembly.
11. Opening review preserves capture preview only when capture evidence exists, plus editable rows, retailer/store fields, line validation, total validation and confirm/import.
12. Manual entry opens the focused line modal, exposes Cancel/close, shows no capture selector when there are no captures, and discards the unsaved draft on cancellation.
13. At 320, 390/430, 768 and desktop widths there is no unintended horizontal overflow, clipped queue, hidden FAB or bottom-navigation collision.
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
- Existing tests currently expect review auto-expansion and a visible “Cancelar procesamiento” button. Those assertions must be migrated to the accepted queue/review interaction without weakening behavioral coverage.

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

## Status

- [x] Recon complete against `main` at `6fc25b3af3c26e59fa905bb4c672a438a630120f`.
- [x] User-approved prototype translated into executable acceptance criteria.
- [x] Implementation.
- [ ] Local/CI-equivalent validation.
- [ ] Browser visual review.
- [ ] PR created.
- [ ] CI green.
- [ ] Final review complete.
