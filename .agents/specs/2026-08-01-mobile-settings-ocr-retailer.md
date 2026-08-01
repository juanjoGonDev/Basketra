# Mobile settings, OCR progress and receipt retailer

## Request

Improve the user-visible mobile workflow based on production screenshots:

- repair the Settings layout so cards, metrics and logs remain readable on narrow devices and in both light and dark color schemes;
- remove the redundant local-login notice;
- replace the OCR-only text status with a visible, accessible running progress treatment;
- capture the receipt retailer and suggest previously stored retailers while the user types;
- keep direct browser screenshots, videos and traces as acceptance evidence.

## Evidence

The supplied 691 × 1536 Android screenshots show:

- the Settings heading partially hidden after navigation;
- operational cards without internal padding, with headings touching borders;
- runtime metric and log surfaces using a light fallback background in dark mode, making values unreadable;
- the fixed bottom navigation covering lower Settings content;
- OCR represented only by `Leyendo el ticket con OCR local…`, without a visual running state or elapsed time;
- no field identifying the retailer before receipt confirmation.

Current code confirms the causes:

- `operations.css` uses the undefined `--surface-subtle` token with a light fallback and does not pad `.operations-card`;
- the Settings shell retains the legacy local-login card;
- `receipts.js` exposes only a text status during the synchronous OCR request;
- receipts already reference `retailers`, but confirmation does not populate that relation and no retailer suggestion endpoint exists.

## Scope

### Included

- responsive Settings layout and dark/light token corrections;
- deterministic route scroll reset and bottom-safe content spacing;
- accessible indeterminate OCR progress with elapsed time and cancellation;
- optional retailer input with debounced, abortable server suggestions;
- canonical retailer persistence in SQLite through receipt confirmation;
- unit, integration and Playwright regression coverage;
- visual evidence in mobile light and dark themes.

### Excluded

- per-character OCR telemetry or fabricated percentage completion;
- resident OCR workers, polling jobs, WebSockets or additional runtime dependencies;
- store/branch geolocation modelling;
- changes to Raspberry configuration, deployment, release or secrets.

## Decisions

1. OCR progress is indeterminate because the current bounded Tesseract process does not expose trustworthy page percentage events. The UI shows an animated progress track, elapsed time, capture count and an explicit cancel action instead of inventing a percentage.
2. Retailer names remain optional for historical compatibility and manual/unknown receipts.
3. SQLite remains authoritative. The browser never uses local storage as a competing retailer history.
4. Retailer matching and insertion are case-insensitive and transactionally owned by `BasketraDatabase`.
5. Suggestions use one bounded same-origin endpoint, debounce input, cancel stale requests and ignore obsolete responses.
6. Existing light/dark automatic theme behavior is preserved; tests explicitly emulate both schemes.

## Acceptance criteria

- Settings headings and card content are not clipped at 320, 360, 390, 430 and tablet widths.
- Operational cards have coherent padding, no horizontal overflow and readable metric/log contrast in light and dark schemes.
- Fixed navigation does not obscure the final Settings controls.
- The `Sin inicio de sesión local` card is absent.
- Starting OCR displays a visible progress region with running animation, elapsed time, capture count and cancellation.
- Cancelling aborts the request, restores controls and preserves captures and manual edits.
- Receipt review includes an optional `Comercio` combobox.
- Typing at least two characters requests saved retailer suggestions after a short debounce.
- Stale suggestion responses cannot replace newer input.
- Confirming a receipt with a retailer persists/reuses one case-insensitive retailer and links the receipt to it.
- Confirming without a retailer remains valid.
- No receipt contents, retailer search values or provider credentials are added to logs.
- Playwright records directly reviewable mobile screenshots/video for Settings light, Settings dark, OCR running/cancelled and retailer suggestion/confirmation states.

## Checks

Planned:

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm deadcode`
- `pnpm deps:check`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm test:browser`
- `pnpm test:coverage`
- `pnpm build`
- `pnpm quality`
- pull-request security, browser, container, AMD64, ARM64 and CodeQL jobs
- direct visual-evidence publication for the exact PR head

## Risks and rollback

- Risk: an unbounded autocomplete query could increase database work. Mitigation: minimum query length, escaped prefix search and a hard limit.
- Risk: duplicate retailers differing only by case. Mitigation: lookup and insertion run inside the existing immediate receipt transaction using `COLLATE NOCASE`.
- Risk: progress could imply false precision. Mitigation: no percentage is shown; elapsed time and indeterminate state are explicit.
- Rollback: revert the pull request. The optional retailer relation uses the existing schema and does not require a migration.

## Delivery

- Branch: `agent/feat-mobile-receipt-source-progress`
- Target: `main`
- Merge, release, deployment and Raspberry changes require separate authorization.

## Status

In progress.
