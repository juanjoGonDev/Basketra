# Basketra

Basketra is a private, mobile-first grocery price intelligence application for personal use. It stores receipt evidence and immutable price observations, keeps shopping lists, normalizes unit prices, and generates deterministic purchase plans.

## Status

The repository contains a working dependency-free foundation built on Node.js 22 and `node:sqlite`:

- installable static PWA shell;
- local shopping lists and FTS5 suggestions;
- image/PDF evidence upload with magic-byte validation and SHA-256 deduplication;
- receipt arithmetic review and idempotent transactional confirmation;
- provider-neutral OCR, AI, and offer contracts;
- OpenAI-compatible structured-output adapter with local runtime validation hooks;
- exact money/unit normalization;
- deterministic single-retailer, balanced, and maximum-saving plans;
- SQLite backup and restore validation;
- authentication, security headers, body limits, hibernation, and graceful shutdown;
- Docker deployment with Raspberry Pi resource limits.

A production OCR engine and live supermarket/Amazon evidence providers remain external integration work. The current receipt flow supports embedded text or manual transcription and preserves original captures. A mobile Chromium Playwright suite is included and runs in pull-request CI with screenshots, video and traces; local browser execution remains unverified in this environment because browser binaries are unavailable.

## Requirements

- Node.js 22.16.x
- pnpm 10.15.0
- TypeScript 5.8.3 for static checking
- Docker with Buildx for container validation

The runtime has no third-party npm dependencies.

## Local development

```bash
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm install --frozen-lockfile
npm install --global typescript@5.8.3
cp .env.example .env
pnpm dev
```

Open `http://127.0.0.1:3000`.

## Quality gates

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm deadcode
pnpm deps:check
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:browser
pnpm test:coverage
pnpm build
pnpm quality
```

`pnpm test:coverage` enforces 100% lines, branches, and functions for the project-owned domain layer.

## Docker

```bash
cp .env.example .env
# Set BASKETRA_AUTH_TOKEN before sharing access.
docker compose build
docker compose up -d
docker compose ps
curl http://127.0.0.1:3000/health
```

The compose file binds only to `127.0.0.1` by default. Access it through a private VPN, SSH tunnel, or an authenticated private reverse proxy. Do not publish the port directly to the internet.

## Data and backup

Persistent data lives in the `basketra-data` volume. Create and validate a backup through the authenticated API:

```bash
curl -X POST http://127.0.0.1:3000/api/v1/backup \
  -H "Authorization: Bearer $BASKETRA_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"basketra-manual.db"}'

curl -X POST http://127.0.0.1:3000/api/v1/restore/validate \
  -H "Authorization: Bearer $BASKETRA_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"basketra-manual.db"}'
```

See [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md).

## AI provider configuration

Basketra treats `webApi` and other compatible services as ordinary OpenAI-compatible providers:

```dotenv
BASKETRA_AI_BASE_URL=http://10.0.0.20:8080/v1/
BASKETRA_AI_API_KEY=replace-me
BASKETRA_AI_MODEL=your-model
BASKETRA_AI_TIMEOUT_MS=30000
BASKETRA_AI_MAX_RETRIES=1
```

The browser never receives the API key. Provider URLs are administrative configuration, never request input. Structured results are validated locally before use.

## Architecture and operations

- [spec.md](spec.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [SECURITY.md](SECURITY.md)
- [PRIVACY.md](PRIVACY.md)
- [THREAT_MODEL.md](THREAT_MODEL.md)
- [RESOURCE_BUDGET.md](RESOURCE_BUDGET.md)
- [OCR_LIMITATIONS.md](OCR_LIMITATIONS.md)
- [PRICE_CONFIDENCE.md](PRICE_CONFIDENCE.md)
- [AMAZON_LIMITATIONS.md](AMAZON_LIMITATIONS.md)
