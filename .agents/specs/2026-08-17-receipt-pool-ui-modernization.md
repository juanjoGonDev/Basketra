# Receipt pool and incremental UI modernization

## Request

Ensure receipt processing has a real two-slot local OCR pool: when one image finishes OCR, the next pending image must start immediately even while AI verification remains active. Modernize Basketra's frontend incrementally using the updated UI/UX agent guide while preserving the dependency-free static PWA architecture.

## Evidence

- `src/receipts/service.ts` already owns the canonical backend `ReceiptPageTaskQueue` with OCR concurrency 2 and a separate AI queue with concurrency 1.
- AI-enabled receipt processing now uses the persisted background extraction job introduced before this task, so the server-side queue is the production scheduler for the reported flow.
- The previous concurrency test released both initial OCR calls together. It proved maximum concurrency, but did not prove the exact regression boundary reported by the user: releasing one OCR slot must immediately start page three while page two OCR and page one AI are still active.
- `src/web/styles.css` already owns the product's shared tokens and primitives. The current interface still overuses nested surfaces, shadows and decorative hero treatment relative to the updated UI/UX guidance.
- `src/web/index.html` already permits browser zoom and uses native controls and semantic dialogs/navigation.
- The repository intentionally preserves a dependency-free runtime. No external component library is required.

## Decision

1. Keep `ReceiptPageTaskQueue` as the single canonical scheduler instead of adding a second pool implementation.
2. Strengthen the regression test around the exact slot-refill behavior: two OCR tasks active, release only one, assert page three starts immediately while AI remains serialized.
3. Keep AI verification ordered at concurrency 1 because receipt conversation affinity depends on page order.
4. Modernize the existing shared UI primitives rather than introducing React, shadcn/ui, Radix, Mantine, Primer, Storybook, or another parallel design system.
5. Apply the UI guidance globally through a small semantic layer: flatter surfaces, reduced elevation/decorative effects, tighter typography, consistent radii, clearer grouping, compact receipt progress, responsive touch targets, zoom safety, and reduced-motion support.
6. Preserve product IDs, routes, business contracts, accessible names, existing form behavior, and the dependency-free runtime.
7. Do not add a new receipt-progress API merely for this visual task. The current background-job API is aggregate; granular persisted page telemetry would be a separate API/data-contract change and is not required to prove or fix OCR scheduling.

## Scope

- Exact regression coverage for the canonical receipt OCR/AI queues.
- Shared UI tokens/primitives and receipt-progress presentation.
- PWA shell loading/caching for the added shared stylesheet.
- Responsive, zoom, reduced-motion and offline-shell regression coverage.
- Existing CI, browser evidence and container checks.

Out of scope: authentication, business-data migrations, product/pricing rules, deployment architecture, new frontend frameworks/component libraries, a new persisted per-page progress API, and unrelated feature behavior.

## Risks

- Shared visual primitive changes can affect all views. Keep the layer isolated, semantic and reversible, then rely on the existing browser evidence suite across representative views.
- A test that only checks maximum OCR concurrency can regress without detecting delayed slot refill. The new test must control each OCR gate independently.
- Adding a stylesheet without updating the service-worker shell would leave installed PWAs visually stale; cache version and shell assets must move together.

## Tests

- Unit: start two OCR tasks, release only page one, verify page three immediately occupies the freed OCR slot while page two remains active.
- Unit: AI stays at maximum concurrency 1 and verifies pages in receipt order with one session affinity.
- PWA shell: zoom is not disabled; the modern shared stylesheet is loaded and cached; API responses remain excluded from the service-worker cache.
- UI contract: modern layer removes decorative hero treatment/general elevation, contains receipt-progress primitives and honors reduced motion.
- CI: `pnpm quality`, browser E2E, security, container smoke/builds, CodeQL and visual evidence as configured by the repository.

## Rollback

Revert the atomic commits from this branch. The visual layer is isolated in `src/web/modern.css`; no destructive migration or public API change is introduced.

## Acceptance

- With three image captures, at most two local OCR tasks run concurrently.
- As soon as one of the initial OCR tasks completes, page three starts without waiting for the other OCR task or the active AI verification.
- AI verification remains ordered and serialized.
- The exact scheduling behavior is protected by a deterministic regression test.
- Shared UI becomes flatter, less card-heavy and more internally consistent without introducing a new framework, component library or parallel design system.
- Receipt progress controls use the same shared visual language and remain touch-friendly and responsive.
- Mobile remains the primary layout, supports 320 CSS px and browser zoom, and desktop is a progressive enhancement of the same information architecture.
- Reduced-motion behavior and offline PWA styling are preserved.
- Relevant quality, browser, security, container and CI checks pass.
- A non-draft pull request is open and remains unmerged until explicit approval.

## Delivery

Branch: `agent/fix-receipt-pool-ui-modernization`.
Atomic Conventional Commits only. PR #31 targets `main` and must remain unmerged pending explicit approval.

## Status

Accepted by the user on 2026-08-17. Implementation complete; CI validation in progress.
