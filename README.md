# Basketra

Basketra is a private, mobile-first grocery application for personal use. It stores receipt evidence and immutable price observations, manages complete shopping-list workflows, normalizes unit prices, and generates deterministic purchase plans.

## Status

The repository contains a dependency-free Node.js 22 application built on `node:sqlite`:

- installable static PWA shell;
- shopping-list create, select, rename, delete, edit, complete, quantity, and reorder workflows;
- local FTS5 suggestions that do not require AI;
- camera, gallery, and PDF capture with shared validation;
- persistent same-origin image previews excluded from service-worker caching;
- MIME allowlisting, magic-byte validation, SHA-256 deduplication, and traversal prevention;
- receipt extraction, manual correction, arithmetic review, and idempotent transactional confirmation;
- provider-neutral OCR, AI, and offer contracts;
- exact money and unit normalization;
- deterministic single-retailer, balanced, and maximum-saving plans;
- SQLite backup, restore validation, and guarded startup migrations;
- strict security headers, body limits, hibernation, and graceful shutdown;
- local Docker development plus private AMD64/ARM64 GHCR delivery for Raspberry Pi.

A production OCR engine and live supermarket/Amazon evidence providers remain external integration work. The receipt workflow works without AI through manual transcription and preserves the original captures. Pull-request CI runs unit, integration, static PWA, mobile Chromium, security, container smoke, vulnerability, AMD64, and ARM64 checks with browser screenshots, video, and traces.

## Supported access model

Basketra has no internal application token or login screen. It is a single-installation private application and must be protected by infrastructure:

- loopback bind with a VPN or SSH tunnel;
- a reviewed LAN-only bind plus firewall rules;
- or an authenticated private reverse proxy with TLS.

The default host and Compose configurations bind to `127.0.0.1`. Direct public internet exposure is unsupported. Anyone who can reach the Basketra HTTP service can use its API, diagnostics, backups, lists, and receipt data.

## Requirements

- Node.js 22.23.1
- pnpm 10.15.0
- TypeScript 5.8.3 for static checking
- Docker with Buildx for container validation

The runtime has no third-party npm dependencies. The production container removes npm, Corepack, pnpm, and Yarn after the build stage because package managers are not required at runtime.

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
docker compose build
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:3000/health
curl --fail http://127.0.0.1:3000/readiness
```

The local Compose file builds `basketra:local` and publishes only on host loopback. Use a VPN, SSH tunnel, or authenticated private reverse proxy for remote access. Do not change the bind to a public interface without a reviewed firewall and access-control design.

## Private Raspberry deployment

Successful pushes to `main` publish a private multi-architecture image to GHCR only after every quality, security, browser, smoke, AMD64, and ARM64 gate passes:

1. Buildx publishes only `ghcr.io/juanjogondev/basketra:<full-commit-sha>`.
2. CI verifies its registry digest and AMD64/ARM64 manifest entries.
3. CI pulls and runs that exact digest under production restrictions.
4. Only after readiness and clean shutdown does CI promote the same digest to `stable`.
5. CI verifies `stable` and retains the newest immutable SHA releases.

```bash
COMMIT_SHA=<full-commit-sha>
docker buildx imagetools inspect "ghcr.io/juanjogondev/basketra:${COMMIT_SHA}"
docker pull "ghcr.io/juanjogondev/basketra:${COMMIT_SHA}"
docker pull ghcr.io/juanjogondev/basketra:stable
```

Production startup:

```bash
cp .env.example .env
docker compose -f compose.raspberry.yml config --quiet
docker compose -f compose.raspberry.yml pull basketra
docker compose -f compose.raspberry.yml up -d basketra
curl --fail http://127.0.0.1:3000/readiness
```

The production variant keeps the `basketra-data` volume, loopback bind, resource limits, read-only filesystem, dropped capabilities, and scoped Watchtower labels. The host must authenticate to private GHCR with a credential limited to `read:packages`. See [RASPBERRY_DEPLOYMENT.md](RASPBERRY_DEPLOYMENT.md).

## Shopping lists

The UI and API support complete list management:

- create, select, rename, and delete lists;
- add and edit products;
- increase or decrease quantities;
- mark products as bought and return them to pending;
- reorder products with deterministic contiguous positions;
- preserve the active list and unsubmitted item draft across reloads.

Completion state is stored by schema migration 3. Existing databases are backed up and migrated transactionally before readiness.

## Receipt workflow

1. Capture a photo with the rear-camera hint or choose images/PDF files.
2. Validate type, size, and server-side signature.
3. Review persistent image thumbnails or PDF placeholders.
4. Reorder or remove captures from the draft without deleting original evidence.
5. Extract with a configured OCR/AI provider or enter a manual transcription.
6. Correct lines and totals.
7. Validate arithmetic through the API.
8. Confirm the idempotent import.

Stored image previews are served from `/api/v1/files/<storage-key>` with strict storage-key validation and `Cache-Control: private, no-store`. PDF content is not exposed through the image-preview route. The service worker excludes all `/api/` requests.

## Data and manual backup

Persistent data lives in `basketra-data`. Run backup calls only through the trusted private access path:

```bash
curl --fail --request POST http://127.0.0.1:3000/api/v1/backup \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-manual.db"}'

curl --fail --request POST http://127.0.0.1:3000/api/v1/restore/validate \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-manual.db"}'
```

See [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md). A named Docker volume is not an independent disaster-recovery copy; export important backups to separately managed storage.

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

The browser never receives the provider key. Provider URLs are administrative environment configuration, never request input. Structured results are validated locally before use.

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
