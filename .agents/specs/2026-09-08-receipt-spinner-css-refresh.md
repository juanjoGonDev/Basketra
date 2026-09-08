# Receipt spinner CSS refresh

## Request

The floating receipt-analysis progress arc is visible but appears static in the user's Brave session. The user explicitly expects a real CSS rotation defined with `from`/`to` keyframes while processing.

## Evidence

- `src/web/receipt-review.css` already defines `@keyframes receipt-source-progress-spin` with explicit `from { transform: rotate(0deg); }` and `to { transform: rotate(360deg); }`.
- Browser regression coverage already verifies that the spinner's computed transform changes between successive animation frames while the queue aggregate state is `working`.
- `src/web/sw.js` treated every shell asset, including `/receipt-review.css`, cache-first. A live tab could therefore continue receiving an older cached receipt stylesheet even though the current branch contains the correct `from`/`to` animation, especially in local/PWA sessions where the shell cache remains active.

## Decision

Do not rewrite the spinner animation again without evidence: the requested explicit `from`/`to` transform animation is already canonical and browser-tested.

Make `/receipt-review.css` network-first while online, with the existing cache as offline fallback. Keep all other shell assets on their existing cache-first policy. This is the smallest change that addresses the observed delivery mismatch without weakening PWA offline behavior or duplicating CSS.

## Acceptance

- The spinner keyframes remain explicit `from` 0deg → `to` 360deg.
- While online, `/receipt-review.css` is fetched from the network before falling back to the shell cache.
- A successful fresh stylesheet response updates the versioned shell cache.
- When offline, the cached receipt stylesheet still loads.
- Other shell assets retain cache-first behavior.
- Service-worker coverage remains 100% lines/functions/branches.
- Pull Request Quality and CodeQL are green on the exact final head.

## Tests

- `tests/e2e/pwa-shell.test.ts` statically requires the explicit `from`/`to` spinner keyframes and the network-first receipt stylesheet policy.
- `tests/unit/service-worker-shell.test.ts` exercises both fresh online delivery and offline cached fallback for `/receipt-review.css`.
- Existing Browser receipt-analysis coverage remains the runtime authority for actual transform progression.

## Rollback

Revert the focused service-worker freshness change and its tests. No API, database, persistence, dependency or migration change is involved.

## Status

- [x] Root cause isolated from current CSS and Browser evidence.
- [x] Focused service-worker freshness change implemented.
- [x] Static PWA regression added.
- [x] Service-worker 100% coverage regression added.
- [ ] Exact-head Pull Request Quality green.
- [ ] Exact-head CodeQL green.
- [ ] Final PR/body review complete.
