# Basketra

Basketra is a private, mobile-first grocery application for personal use. It stores receipt evidence and immutable price observations, manages shopping-list workflows, normalizes unit prices, and generates deterministic purchase plans.

## Deployment model

Basketra is a single-user, self-hosted application operated by the repository owner. The supported deployment boundary is a trusted LAN/VPN, SSH tunnel, or authenticated private reverse proxy. It is not designed as a public, anonymous, multi-tenant Internet service.

Basketra has no application login or internal access token. Anyone who can reach its HTTP service can use its API, diagnostics, backups, lists, and receipt data, so the network boundary is authoritative. The supplied Compose files publish Basketra only on host loopback (`127.0.0.1:3000`).

## Runtime architecture

The application is dependency-free at runtime and targets Node.js 22 with `node:sqlite`. Tesseract is installed in the production image for local Spanish JPEG/PNG OCR.

Important runtime properties:

- installable static PWA shell;
- complete shopping-list workflows and local FTS5 suggestions;
- camera, gallery, and PDF receipt capture;
- MIME allowlisting, magic-byte validation, SHA-256 deduplication, and traversal prevention;
- local serialized Spanish OCR for JPEG/PNG images;
- optional OpenAI-compatible verification and provider-dependent PDF OCR;
- durable receipt AI jobs and binary multipart attachment transport;
- exact backend money/unit calculations and deterministic purchase plans;
- SQLite-backed runtime settings, backups, restore staging, logs, and capability cache;
- bounded resource use, hibernation, graceful shutdown, and private-route recovery;
- AMD64/ARM64 container validation and trusted GHCR publication.

## Configuration ownership

Basketra does not use functional application environment variables and does not require a `.env` file.

Immutable bootstrap values are determined by the execution context:

- native execution: `127.0.0.1:3000`, `./data`, `./tmp`;
- container execution: `0.0.0.0:3000`, `/data`, `/tmp/basketra`.

Mutable operator settings are persisted in Basketra SQLite and edited from **Ajustes**:

- WebAPI base URL;
- optional WebAPI token;
- model;
- maximum AI retries;
- Overpass URL;
- local HTTP request-body limit;
- idle hibernation delay.

Saving Settings applies the new values to subsequent operations. No `.env` edit, process restart, or container recreation is required. The WebAPI token is write-only: the browser receives only whether one exists and its mask. Leaving the token field empty preserves the existing credential; the explicit delete control clears it.

WebAPI is the source of truth for provider capabilities and AI attachment limits. Basketra does not define a competing AI attachment-size policy. It reads WebAPI `/v1/capabilities` live and may use only the last validated SQLite snapshot as a stale fallback if that capability read is temporarily unavailable. Authentication failures are never hidden by the fallback.

## Requirements

- Node.js 22.23.1
- pnpm 10.15.0
- TypeScript 5.8.3 for static checking
- Docker with Buildx for container validation and the supported OCR runtime

Local `pnpm dev` requires a `tesseract` executable with Spanish language data only when exercising real image OCR. The production image includes and validates both automatically.

## Local development

```bash
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm install --frozen-lockfile
npm install --global typescript@5.8.3
pnpm dev
```

Open `http://127.0.0.1:3000`.

For local image OCR:

```bash
tesseract --version
tesseract --list-langs | grep '^spa$'
```

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

Pull-request CI additionally covers browser flows, security policy, container smoke, vulnerability scanning, and AMD64/ARM64 builds. Browser evidence includes screenshots, video, and traces when applicable.

## Local Docker

No `.env` file is required:

```bash
docker compose build
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:3000/health
curl --fail http://127.0.0.1:3000/readiness
```

The local Compose file publishes only on host loopback. Use the Settings screen to configure optional WebAPI/AI integration after Basketra is running.

## Private Raspberry deployment

Authenticate the host to the private GHCR package with a credential restricted to `read:packages`, then validate and start the repository-owned Compose file:

```bash
docker compose -f compose.raspberry.yml config --quiet
docker compose -f compose.raspberry.yml pull basketra
docker compose -f compose.raspberry.yml up -d basketra
docker compose -f compose.raspberry.yml ps
curl --fail http://127.0.0.1:3000/readiness
```

The production Compose file has fixed reviewed runtime controls: loopback publication, `basketra-data`, 128 MiB Node heap, 192 MiB memory/swap cap, 0.75 CPU, PID cap, read-only root filesystem, dropped capabilities, bounded tmpfs, and bounded Docker logs. These are deployment code, not mutable application settings.

The optional scoped Watchtower profile uses its own fixed container configuration and reads GHCR credentials from repository-local `./.docker`, not from a Basketra `.env` file.

See [RASPBERRY_DEPLOYMENT.md](RASPBERRY_DEPLOYMENT.md) for the complete runbook.

## Optional WebAPI / AI configuration

Local JPEG/PNG OCR does not require AI. Configure WebAPI only for optional verification, AI-assisted workflows, or provider-dependent PDF OCR.

For WebAPI running on the Raspberry host at port 3001, open **Ajustes → IA** and set:

- URL: `http://host.docker.internal:3001/v1/`
- Model: for example `default`
- Token: only if WebAPI requires a managed token
- Reintentos máximos: the desired bounded retry count

Inside a container, `127.0.0.1` refers to Basketra itself. `compose.yml` and `compose.raspberry.yml` map `host.docker.internal` to Docker's host gateway. If WebAPI runs on another trusted machine, use that machine's private LAN/VPN address.

The Settings verification action performs a real end-to-end provider check. For WebAPI it sends `multipart/form-data`: JSON metadata is placed in the `request` field and the repository-owned JPEG fixture is sent once as a binary `files` part. Basketra does not duplicate the image as Base64 in request JSON.

Durable receipt `POST /v1/responses` uses the same binary principle: request metadata stays JSON while the original attachment bytes travel as multipart binary. WebAPI validates the attachment against its live persisted runtime limits.

A successful provider check proves authentication, routing, binary attachment handling, image processing, and strict structured output together. Settings reports redacted actionable outcomes and never exposes the raw token, request headers, fixture bytes, or provider response bodies.

There is no Basketra AI wall-clock timeout setting. Provider/upstream timeout policy remains upstream-owned; caller cancellation and the bounded receipt-verification workflow still stop abandoned work.

## Receipt workflow

1. Capture JPEG/PNG/PDF evidence.
2. Validate and persist the file.
3. Reorder/remove captures from the draft without deleting original evidence.
4. Run local OCR for JPEG/PNG or provider OCR for PDF when configured.
5. Optionally verify each page with AI.
6. Edit product, quantity, unit price, discounts, and line totals.
7. Validate the declared total.
8. Confirm the idempotent import.

Receipt AI work uses one bounded workflow deadline and serialized AI execution. PDF OCR reuses its multimodal provider within an extraction. Provider/runtime settings are snapshotted per receipt extraction so one receipt cannot silently switch provider or retry policy halfway through; newly saved settings apply to the next operation.

WebAPI capability limits remain authoritative. Binary attachment bytes are not counted as JSON metadata budget.

## Runtime operations

Settings exposes operational state without revealing process environment or arbitrary host logs:

- deployed version/revision, start time, uptime, and RSS memory;
- editable SQLite-backed connections and local limits;
- AI configuration state and explicit synthetic-image capability probe;
- bounded redacted client/server application events;
- portable backup creation/download;
- validated backup import and staged restore.

The private-route heartbeat pauses while hidden, uses slow checks while healthy, faster bounded checks while disconnected, suppresses stale responses, and refreshes state after VPN route recovery.

Application logs are NDJSON under the persistent data volume. Rotation defaults to 10,000 lines or 40 MiB for the active file with bounded archives. Receipt text, uploaded filenames, request bodies, headers, credentials, provider responses, and filesystem paths are excluded from client log fields.

## Data, backup, and restore

Persistent state lives in `basketra-data` in Docker deployments. Settings can create a portable SQLite backup, download it, import a candidate `.db`, validate integrity/schema, and stage a restore using the explicit confirmation phrase.

API equivalents on the trusted private path include:

```bash
curl --fail --request POST http://127.0.0.1:3000/api/v1/backup \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-manual.db"}'

curl --fail --output basketra-manual.db \
  http://127.0.0.1:3000/api/v1/backups/basketra-manual.db
```

A staged restore creates a pre-restore backup, writes an atomic pending marker, stops cleanly, revalidates the candidate at startup, and only then replaces the inactive primary database. Failed restores preserve the current database and move the failed marker aside. Preserve `/data/files` with compatible database backups for complete disaster recovery.

See [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md).

## Publication and rollback

Trusted `main` publication builds a full-SHA multi-architecture candidate, verifies its digest/platforms/runtime, and only then promotes the identical digest to `stable` and the immutable semantic version tag. A rerun of the same commit reuses its assigned version.

To inspect a release:

```bash
COMMIT_SHA=<full-commit-sha>
docker buildx imagetools inspect "ghcr.io/juanjogondev/basketra:${COMMIT_SHA}"
docker pull "ghcr.io/juanjogondev/basketra:${COMMIT_SHA}"
docker pull ghcr.io/juanjogondev/basketra:stable
```

Rollback is explicit: pin the `basketra.image` value in a reviewed local Compose copy/override to a retained immutable SHA or numeric version, recreate that service, and verify readiness. Do not use a hidden environment-variable override as a second configuration owner.

## Architecture and operations

- [AGENTS.md](AGENTS.md)
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
