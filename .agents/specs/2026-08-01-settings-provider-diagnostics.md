# Settings provider diagnostics and desktop layout

## Request

Repair the deployed Settings screen after the 1.0.1 release:

- make the log-copy control reliably present instead of depending on a mixed cached module graph;
- explain exactly how the optional OpenAI-compatible provider is tested;
- make an unreachable provider actionable for the common Basketra + webApi topology;
- improve the desktop Settings layout while preserving mobile light/dark behavior;
- verify the final UI with direct screenshots and browser acceptance tests.

## Evidence

The production screenshot is served by release revision `8a81acc40eb6` and shows:

- the current operations cards but no `Copiar logs` control, which proves a mixed static-module version can occur despite the server revision being current;
- `BASKETRA_AI_BASE_URL=http://host.docker.internal:3001/v1/` returning `AI_UNREACHABLE`;
- webApi exposes `GET /v1/models` and accepts `Authorization: Bearer <API_KEY>`;
- webApi binds to `localhost` by default and its `.env.example` also uses `HOST=localhost`;
- inside the Basketra container, `host.docker.internal` resolves to the Docker host (the Raspberry), not to another computer on the LAN;
- the desktop page is constrained to the mobile shell width, the four runtime metrics are compressed into one row, the start timestamp wraps character-by-character, and the fixed mobile navigation overlays the lower content.

## Decisions

1. The operations module owns the complete log UI and clipboard behavior. The generic API client must not augment Settings after a dynamic import.
2. The PWA activates updated caches immediately and claims existing clients to reduce mixed-version module graphs.
3. The provider test remains a bounded server-side `GET` to `<base URL>/models` with optional Bearer authorization. No provider response body or credential is exposed.
4. `host.docker.internal` is described accurately as the Docker host only. A provider on another machine must use that machine's private LAN/VPN address and must listen on a non-loopback interface.
5. The secure webApi default (`HOST=localhost`) is not silently widened. Basketra surfaces the required `HOST=0.0.0.0` operational setting only when remote access is intended.
6. Desktop Settings uses a wider bounded container, two-column cards without an empty grid cell, two-by-two runtime metrics, and a desktop navigation rail that does not cover content. Mobile remains bottom-navigation-first.

## Acceptance criteria

- `Copiar logs` is part of the authoritative operations markup and works without post-import DOM discovery.
- Copying returns up to 500 complete sanitized JSON Lines events and retains the HTTP clipboard fallback.
- Updated service workers call `skipWaiting()` and `clients.claim()` and remove old caches.
- The provider card states the exact request method/path and whether Bearer authentication is configured without exposing the key.
- `AI_UNREACHABLE` with `host.docker.internal` explains that the name targets the Raspberry host; another computer requires its private address.
- webApi compatibility is documented: `GET /v1/models`, matching API key, `HOST=0.0.0.0` for remote clients, and firewall/VPN restriction.
- At desktop width, Settings uses the available screen coherently, runtime metrics do not collapse into narrow columns, and navigation does not obscure logs or backups.
- Existing 320–768 px light/dark layouts remain free from horizontal overflow.
- Browser tests cover authoritative copy controls, provider request explanation, unreachable-host guidance, desktop layout, and current mobile themes.

## Checks

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:browser`
- `pnpm test:coverage`
- `pnpm build`
- `pnpm quality`
- PR security, container, AMD64, ARM64, CodeQL and visual-evidence jobs

## Risks and rollback

- Risk: desktop navigation changes could reduce usable width. Mitigation: activate only at wide viewports and preserve a bounded main column.
- Risk: clipboard APIs differ on private HTTP origins. Mitigation: preserve the selection fallback and browser regression test.
- Risk: operational guidance could encourage accidental exposure. Mitigation: keep webApi loopback by default and explicitly require LAN/VPN/firewall restriction when binding remotely.
- Rollback: revert the pull request. No database, migration, secret, provider protocol or deployment schema changes are required.

## Delivery

- Branch: `agent/fix-settings-provider-diagnostics`
- Target: `main`
- Merge, release and Raspberry environment changes require separate authorization.

## Status

In progress.
