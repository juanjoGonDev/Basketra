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
- SQLite backup, restore validation, and guarded startup migrations;
- authentication, security headers, body limits, hibernation, and graceful shutdown;
- local Docker development plus private AMD64/ARM64 GHCR delivery for Raspberry Pi.

A production OCR engine and live supermarket/Amazon evidence providers remain external integration work. The current receipt flow supports embedded text or manual transcription and preserves original captures. Pull-request CI verifies the mobile Chromium suite with screenshots, video and traces, hardened container smoke tests, vulnerability scanning, Compose variants, and AMD64/ARM64 builds.

## Requirements

- Node.js 22.23.1
- pnpm 10.15.0
- TypeScript 5.8.3 for static checking
- Docker with Buildx for container validation

The application runtime has no third-party npm dependencies. The production container also removes npm, Corepack, pnpm and Yarn after the build stage because package managers are not required to execute Basketra.

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

## Local Docker

```bash
cp .env.example .env
# Set BASKETRA_AUTH_TOKEN before sharing access.
docker compose build
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:3000/health
curl --fail http://127.0.0.1:3000/readiness
```

The local Compose file builds `basketra:local` and binds only to `127.0.0.1`. Access it through a private VPN, SSH tunnel, or an authenticated private reverse proxy. Do not publish the port directly to the internet.

## Private Raspberry deployment

Successful pushes to `main` publish a private multi-architecture image to GHCR only after every quality, security, browser, smoke, AMD64, and ARM64 job has passed. Publication is staged rather than assigning both tags during the build:

1. Buildx publishes only `ghcr.io/juanjogondev/basketra:<full-commit-sha>`.
2. CI inspects that SHA tag in GHCR and verifies its registry digest and AMD64/ARM64 manifest entries.
3. CI pulls the SHA tag, runs the exact digest under production limits, requires `/readiness`, and verifies a clean shutdown.
4. Only then does CI promote that same digest to `ghcr.io/juanjogondev/basketra:stable` without rebuilding.
5. CI verifies that `stable` resolves to the validated digest.

Manual registry verification after an approved merge:

```bash
COMMIT_SHA=<full-commit-sha>
docker buildx imagetools inspect "ghcr.io/juanjogondev/basketra:${COMMIT_SHA}"
docker pull "ghcr.io/juanjogondev/basketra:${COMMIT_SHA}"
docker pull ghcr.io/juanjogondev/basketra:stable
```

The production variant is separate from local development:

```bash
cp .env.example .env
# Generate and set BASKETRA_AUTH_TOKEN before continuing.
docker compose -f compose.raspberry.yml pull basketra
docker compose -f compose.raspberry.yml up -d basketra
curl --fail http://127.0.0.1:3000/readiness
```

It keeps the named `basketra-data` volume, loopback bind, resource limits, read-only filesystem, dropped capabilities, and scoped Watchtower labels. The Raspberry host must authenticate to private GHCR with a credential limited to `read:packages`. See [RASPBERRY_DEPLOYMENT.md](RASPBERRY_DEPLOYMENT.md) for secure login, token generation, startup migrations, backups, restore, SHA rollback, Watchtower compatibility, and verification procedures.

## Startup migration safety

The database is opened and migrated before the HTTP listener becomes ready. If migrations are pending, Basketra creates and validates a pre-migration backup, applies the complete pending batch transactionally, validates database integrity and target version, and only then proceeds to readiness. A failed migration rolls back the batch and prevents the container healthcheck from succeeding.

Destructive migrations are code-level opt-in and are rejected by default. There is no environment flag that silently enables them.

## Data and manual backup

Persistent data lives in the `basketra-data` volume. Create and validate a backup through the authenticated API:

```bash
curl --request POST http://127.0.0.1:3000/api/v1/backup \
  --header "Authorization: Bearer $BASKETRA_AUTH_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-manual.db"}'

curl --request POST http://127.0.0.1:3000/api/v1/restore/validate \
  --header "Authorization: Bearer $BASKETRA_AUTH_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-manual.db"}'
```

See [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md) and [RASPBERRY_DEPLOYMENT.md](RASPBERRY_DEPLOYMENT.md).

## AI provider configuration

Basketra treats `webApi` and other compatible services as ordinary OpenAI-compatible providers:

```dotenv
BASKETRA_AI_BASE_URL=http://10.0.0.20:8080/v1/
BASKETRA_AI_API_KEY=replace-me
BASKETRA_AI_MODEL=your-model
BASKETRA_AI_TIMEOUT_MS=30000
BASKETRA_AI_MAX_RETRIES=1
BASKETRA_AI_IMAGE_CAPABILITY=true
BASKETRA_AI_PDF_CAPABILITY=false
```

The browser never receives the API key. Provider URLs are administrative configuration, never request input. Structured results are validated locally before use.

## Architecture and operations

- [spec.md](spec.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [SECURITY.md](SECURITY.md)
- [PRIVACY.md](PRIVACY.md)
- [THREAT_MODEL.md](THREAT_MODEL.md)
- [RESOURCE_BUDGET.md](RESOURCE_BUDGET.md)
- [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md)
- [RASPBERRY_DEPLOYMENT.md](RASPBERRY_DEPLOYMENT.md)
- [OCR_LIMITATIONS.md](OCR_LIMITATIONS.md)
- [PRICE_CONFIDENCE.md](PRICE_CONFIDENCE.md)
- [AMAZON_LIMITATIONS.md](AMAZON_LIMITATIONS.md)
