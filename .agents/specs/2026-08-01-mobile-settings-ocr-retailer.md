# Mobile settings, OCR progress and receipt retailer

## Request

Improve the user-visible mobile workflow based on production screenshots:

- repair the Settings layout so cards, metrics and logs remain readable on narrow devices and in both light and dark color schemes;
- remove the redundant local-login notice;
- replace the OCR-only text status with a visible, accessible running progress treatment;
- capture the receipt retailer and suggest previously stored retailers while the user types;
- allow the complete censored application log events to be copied to the clipboard for support and incident diagnosis;
- keep direct browser screenshots, videos and traces as acceptance evidence.

## Evidence

The supplied 691 × 1536 Android screenshots show:

- the Settings heading partially hidden after navigation;
- operational cards without internal padding, with headings touching borders;
- runtime metric and log surfaces using a light fallback background in dark mode, making values unreadable;
- the fixed bottom navigation covering lower Settings content;
- OCR represented only by `Leyendo el ticket con OCR local…`, without a visual running state or elapsed time;
- no field identifying the retailer before receipt confirmation.

The follow-up support workflow also requires copying logs directly from Settings so they can be pasted into a diagnostic conversation without manually selecting individual rendered rows.

Current code confirms the causes:

- `operations.css` uses the undefined `--surface-subtle` token with a light fallback and does not pad `.operations-card`;
- the Settings shell retains the legacy local-login card;
- `receipts.js` exposes only a text status during the synchronous OCR request;
- receipts already reference `retailers`, but confirmation does not populate that relation and no retailer suggestion endpoint exists;
- the log UI renders a shortened localized summary and has no clipboard action for the complete event objects.

## Scope

### Included

- responsive Settings layout and dark/light token corrections;
- deterministic route scroll reset and bottom-safe content spacing;
- accessible indeterminate OCR progress with elapsed time and cancellation;
- optional retailer input with debounced, abortable server suggestions;
- canonical retailer persistence in SQLite through receipt confirmation;
- clipboard export of the bounded retained log tail as compact JSON Lines;
- an insecure-private-HTTP clipboard fallback for browsers that do not expose `navigator.clipboard`;
- unit, integration and Playwright regression coverage;
- visual evidence in mobile light and dark themes.

### Excluded

- per-character OCR telemetry or fabricated percentage completion;
- resident OCR workers, polling jobs, WebSockets or additional runtime dependencies;
- store/branch geolocation modelling;
- unbounded browser loading of every rotated historical log file;
- changes to Raspberry configuration, deployment, release or secrets.

## Decisions

1. OCR progress is indeterminate because the current bounded Tesseract process does not expose trustworthy page percentage events. The UI shows an animated progress track, elapsed time, capture count and an explicit cancel action instead of inventing a percentage.
2. Retailer names remain optional for historical compatibility and manual/unknown receipts.
3. SQLite remains authoritative. The browser never uses local storage as a competing retailer history.
4. Retailer matching and insertion are case-insensitive and transactionally owned by `BasketraDatabase`.
5. Suggestions use one bounded same-origin endpoint, debounce input, cancel stale requests and ignore obsolete responses.
6. Existing light/dark automatic theme behavior is preserved; tests explicitly emulate both schemes.
7. Clipboard export serializes the complete sanitized event objects returned by the canonical log endpoint, one compact JSON object per line. It does not copy the shortened visual rendering.
8. The existing 500-event API limit is preserved to prevent a clipboard action from loading tens of megabytes on a 256 MiB Raspberry. The UI states this bound explicitly.
9. Clipboard writes first use the modern API and fall back to a temporary selected textarea because the production private-IP HTTP origin may not be a secure context.

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
- Settings exposes a `Copiar logs` action beside refresh.
- The action copies up to the latest 500 complete sanitized events as newline-delimited compact JSON, including fields omitted from the visual summary.
- Clipboard failure is surfaced without losing the prepared payload, and private HTTP deployments use the selection fallback.
- Copied content never includes filtered receipt text, backup file names, provider credentials or request bodies.
- Playwright records directly reviewable mobile screenshots/video for Settings light, Settings dark, OCR running/cancelled, retailer suggestion/confirmation and clipboard log controls.

## Checks

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
- Risk: clipboard export could allocate excessive memory or expose sensitive fields. Mitigation: reuse the sanitized endpoint, preserve its 500-event bound and test that filtered values remain absent.
- Risk: Clipboard API access is unavailable on the private HTTP origin. Mitigation: a tested selected-text fallback runs from the explicit user action.
- Rollback: revert the pull request. The optional retailer relation uses the existing schema and does not require a migration.

## Delivery

- Branch: `agent/feat-mobile-receipt-source-progress`
- Pull request: `#11`
- Target: `main`
- Merge, release, deployment and Raspberry changes require separate authorization.

## Status

Clipboard log export added to PR #11. Exact-head CI and updated visual evidence remain the delivery gate.
