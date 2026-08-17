# Receipt pool and incremental UI modernization

## Request

Fix receipt processing so local OCR uses a real pool of two concurrent slots: when one image finishes OCR, the next pending image must start immediately even if the completed image is still waiting for or running AI verification. Modernize the Basketra frontend incrementally using the updated UI/UX agent guide while preserving the dependency-free static PWA architecture.

## Evidence

- `src/receipts/service.ts` already owns a backend `ReceiptPageTaskQueue` with OCR concurrency 2 and a separate AI queue with concurrency 1.
- `tests/unit/receipt-ai-concurrency.test.ts` proves the backend can start the third OCR while the first AI verification remains blocked.
- `src/web/receipts.js` also owns a page queue with `PAGE_CONCURRENCY = 2`, but each slot remains occupied for the entire `processCapture()` lifecycle. In the interactive path that lifecycle includes OCR and optional AI, so AI work incorrectly consumes an OCR slot.
- The background extraction job exposes only aggregate job state. The browser currently maps all pages to one inferred stage, so it cannot faithfully render per-page OCR/AI progress.
- `src/web/styles.css` already contains the product's shared tokens and primitives. The current interface still overuses nested surfaces, shadows and decorative hero treatment relative to the updated UI/UX guidance.
- The repository intentionally preserves a dependency-free runtime. No external component library is required to solve these issues.

## Decision

1. Keep one canonical backend scheduler: OCR concurrency remains 2 and AI verification remains serialized at concurrency 1.
2. Make receipt job progress observable per page instead of inventing per-page stages in the browser.
3. Ensure freeing an OCR slot is tied to completion/cancellation/error of OCR work, not to completion of AI verification.
4. Render explicit page stages: pending, OCR, waiting for AI, AI verification, completed, manual review, error and cancelled.
5. Modernize shared frontend primitives incrementally: flatter surfaces, reduced decorative elevation, tighter typography, clearer grouping by spacing, consistent semantic tokens and compact responsive receipt progress.
6. Preserve all product IDs, routes, business contracts, accessible names and dependency-free architecture unless a verified bug requires a focused change.

## Scope

- Receipt extraction scheduling and progress reporting.
- Receipt extraction background job persistence/response only where needed to expose canonical progress.
- Receipt processing UI and progress semantics.
- Shared styles and primitives consumed throughout Basketra where a low-risk token/component change improves consistency.
- Browser, integration and unit regression coverage for concurrency, progress, responsive behavior and accessibility.
- Existing visual evidence workflow updates only when selectors or expected screenshots change.

Out of scope: authentication, database business schema unrelated to receipt jobs, product/pricing rules, deployment architecture, new frontend frameworks or component libraries, and unrelated feature redesigns.

## Risks

- Persisting granular progress can create noisy database writes or SSE invalidations. Progress updates must occur only on meaningful stage transitions.
- Separating OCR and AI scheduling can introduce stale completion races after cancellation/retry. Every transition must remain bound to the current job/page lifecycle.
- Shared visual token changes can affect all views. Keep changes semantic and bounded, and rely on existing browser evidence across representative views.
- Background jobs must continue after the browser closes and must not depend on browser-owned timers or state.

## Tests

- Unit: OCR queue never exceeds 2 active tasks; AI queue never exceeds 1; third OCR starts when an OCR slot frees while AI is still active.
- Unit/integration: page progress transitions are ordered and terminal states do not regress.
- Integration: background job API returns canonical per-page stage information without receipt content in SSE invalidations.
- Browser: three-image receipt shows two OCR tasks initially; a pending third image starts OCR as soon as a slot frees; AI stage does not consume an OCR slot.
- Browser: cancellation, retry, background resume and failure recovery preserve captures and show truthful stage labels.
- Responsive: 320, 390, 768 and desktop widths; no horizontal overflow; zoom remains enabled.
- Accessibility: keyboard operation, visible focus, native controls, accessible progress names and reduced motion.
- Repository: `pnpm quality`, browser tests, build/container checks through CI.

## Rollback

Revert the atomic commits from this branch. The changes do not require a destructive migration and preserve existing receipt evidence.

## Acceptance

- With three image captures, at most two local OCR tasks run concurrently.
- As soon as either active OCR task completes, fails or is cancelled, the next pending OCR starts without waiting for AI verification.
- AI verification remains ordered/serialized when receipt conversation affinity requires it.
- Browser progress is derived from canonical per-page processing state and does not label every page with the aggregate job state.
- Pending, OCR, waiting-for-AI, AI, completed, error and cancelled states are visually and accessibly distinct without relying on color alone.
- Shared UI becomes flatter and more consistent without introducing a new framework, component library or parallel design system.
- Mobile remains the primary layout, supports 320 CSS px and browser zoom, and desktop is a progressive enhancement of the same information architecture.
- Relevant unit, integration, browser, quality and CI checks pass.
- A non-draft pull request is opened. It is not merged without explicit approval.

## Delivery

Branch: `agent/fix-receipt-pool-ui-modernization`.
Use atomic Conventional Commits. Push each cohesive change before moving to the next. Open a non-draft PR and inspect CI.

## Status

Accepted by the user on 2026-08-17. Implementation in progress.
