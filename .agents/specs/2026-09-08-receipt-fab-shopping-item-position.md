# Receipt FAB edge alignment and in-place shopping completion

## Request

Follow-up device review for PR #63 requires two UI corrections in the same delivery:

1. On desktop, the receipt-analysis floating `+` action and its expanded menu must stay near the viewport right edge instead of being aligned to the centered content column.
2. In an open shopping list, marking an item bought must keep that item in its current canonical list position. The row becomes visibly checked/struck-through in place. Clearing the check restores the normal row in the same position. Bought items must no longer move to a separate `Ya en la cesta`/completed section.

## Evidence

- `src/web/receipt-review.css` currently offsets the desktop receipt FAB with the centered content-width calculation, creating a large visible gap on wide screens.
- `src/web/lists.js` currently partitions `model.items` into pending/completed arrays in `renderItems()` and renders completed items into `#completed-items`, which is the direct cause of the position change.
- `model.items` is already the ordered client read model; completion is a status flag and therefore must not become a presentation grouping/order rule.
- The shopping-list API already owns item order independently from the `completed` flag. No schema/API migration is required for this UX correction.
- The prior shopping-list spec says completed items are secondary/collapsible; this task explicitly supersedes that presentation rule while preserving completion state, realtime convergence, bulk actions and optimistic versioning.

## Decision

### Receipt FAB

At desktop widths the FAB remains fixed to the viewport, using the same bounded/safe right inset concept as mobile. The expanded speed dial shares the exact horizontal anchor. It must not be positioned relative to `--content-max` or the navigation rail.

### Shopping completion

- Render the open list from `model.items` in its canonical order without partitioning by completion state.
- `completed` only changes the row state: completion control pressed state, accessible label, semantic class and struck-through/secondary visual treatment.
- Toggling completion never changes item order.
- Toggling a completed row back to pending restores the same row appearance and leaves it at the same index.
- Reordering operates across the one canonical sequence, not separate pending/completed groups.
- Bulk completion/pending actions update state without moving rows.
- The separate completed-items section is removed from the active-list presentation; completed counts may remain as metadata where useful.
- Existing realtime refreshes must reproduce the same canonical order and completion styling on every device.

## Acceptance criteria

1. At desktop width (1280 px and representative wide desktop), the receipt `+` button is within the standard fixed edge inset (32 px maximum target) from the viewport right edge, and the expanded menu shares that anchor.
2. Mobile FAB safe-area/navigation behavior is unchanged.
3. A shopping list with ordered items A, B, C keeps DOM order A, B, C after B is marked completed.
4. B remains interactive in the same list surface, exposes `aria-pressed=true`, and is visibly struck through/secondary without relying on color alone.
5. Unchecking B restores its pending styling and keeps order A, B, C.
6. Reload/realtime resync preserves canonical A, B, C order and B completion styling.
7. No separate completed/`Ya en la cesta` section is displayed in the active list.
8. Swipe/click completion and bulk completion/pending actions follow the same in-place behavior.
9. Item reorder is based on the canonical item sequence regardless of completion status.
10. Existing estimate semantics remain server-owned; completion still determines whether an item contributes exactly as before.
11. Browser tests cover single-toggle, undo-toggle, reload/realtime, multi-select/bulk behavior and desktop receipt FAB alignment.
12. Required quality, browser coverage, CodeQL and final visual review are green on the exact PR head.

## Risks

- Existing tests may encode the old completed-section UX; update them only where the presentation contract intentionally changed.
- Completed-row controls must remain readable and keyboard accessible despite secondary styling.
- Reorder code currently groups by completion state; leaving that rule would create surprising jumps once a mixed-status sequence is rendered together.

## Checks

- Browser coverage now verifies in-place single-item completion, undo, realtime convergence, reload preservation, canonical mixed-status reorder and bulk completion/pending behavior.
- Receipt responsive coverage now asserts the desktop trigger/menu right inset at 1280 px and 1600 px while retaining the existing mobile viewport matrix.
- Full CI and exact-head visual review remain required before delivery.
- CI regression evidence: Browser 6/56 completed both Playwright tests in 35.4 s and uploaded coverage/evidence, but the job-level 1-minute cap cancelled the runner during finalization. The Browser shard job now has a 2-minute envelope while the explicit Playwright command remains capped at 45 s; this preserves the test-runtime budget and only allows setup/artifact teardown to finish.

## Rollback

Frontend/spec/test-only. Reverting the focused commits restores the previous FAB alignment and completed-section presentation. No migration or data rollback is required.

## Status

- [x] Request/evidence captured.
- [x] Implementation.
- [x] Browser regression coverage.
- [ ] CI green.
- [ ] Visual final review.
