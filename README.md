# Basketra

Basketra is a private, mobile-first grocery application for personal use. It stores receipt evidence and immutable price observations, manages complete shopping-list workflows, normalizes unit prices, and generates deterministic purchase plans.

## Status

The repository contains a dependency-free Node.js 22 application built on `node:sqlite`:

- installable static PWA shell;
- shopping-list create, select, rename, delete, edit, complete, quantity, reorder, and mobile swipe workflows;
- local FTS5 suggestions that do not require AI;
- camera, gallery, and PDF capture with shared validation;
- persistent same-origin image previews excluded from service-worker caching;
- MIME allowlisting, magic-byte validation, SHA-256 deduplication, and traversal prevention;
- free local Spanish OCR for JPEG and PNG receipt images;
- editable receipt rows with euro-denominated prices and arithmetic validation;
- optional OpenAI-compatible verification and PDF OCR;
- receipt correction and idempotent transactional confirmation;
- exact backend money and unit normalization;
- deterministic single-retailer, balanced, and maximum-saving plans;
- portable SQLite backup download, validated import, and staged startup restore;
- live runtime version, uptime, AI diagnostics, and bounded redacted application logs;
- visibility-aware private-route heartbeat that recovers after a VPN interruption;
- strict security headers, body limits, hibernation, and graceful shutdown;
- verified patch-versioned AMD64/ARM64 GHCR delivery and GitHub releases for Raspberry Pi.

The runtime has no third-party npm dependencies. Tesseract is installed as an Alpine runtime package and runs only while a receipt image is being recognized. Pull-request CI runs unit, integration, static PWA, mobile Chromium, security, container smoke, vulnerability, AMD64, and ARM64 checks with directly viewable browser screenshots, GIFs, video, and traces.

Live supermarket or Amazon evidence providers remain external integration work.

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
- Docker with Buildx for container validation and the supported OCR runtime

Local `pnpm dev` requires a `tesseract` executable with Spanish language data when exercising real image OCR. The production container includes and validates both automatically.

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

For local image OCR, install Tesseract 5 and verify the Spanish language model:

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

`pnpm test:coverage` enforces 100% lines, branches, and functions for the project-owned domain layer. Playwright covers OCR success and recovery, editable euro rows, progressive swipe actions, full list workflows, camera/gallery persistence, runtime operations, backup import, private-route reconnection, offline behavior, and accessibility states without retries.

## Local Docker

```bash
cp .env.example .env
docker compose build
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:3000/health
curl --fail http://127.0.0.1:3000/readiness
```

The image build fails unless Tesseract and the `spa` model are present. The local Compose file publishes only on host loopback. Use a VPN, SSH tunnel, or authenticated private reverse proxy for remote access.

## Private Raspberry deployment

Successful pushes to `main` publish a private multi-architecture image and GitHub release only after every quality, security, browser, smoke, AMD64, and ARM64 gate passes:

1. CI resolves one stable semantic version for the immutable commit. The first trusted release is `1.0.0`; each subsequent release increments only the patch component.
2. Buildx publishes only `ghcr.io/juanjogondev/basketra:<full-commit-sha>` initially, with the version and revision embedded in the image and visible in the application.
3. CI verifies the registry digest and AMD64/ARM64 manifest entries.
4. CI pulls and runs that exact digest under production restrictions, verifies `/api/v1/runtime`, readiness, resource limits, and clean shutdown.
5. Only after verification does CI promote the same digest to `stable` and the immutable numeric version tag.
6. CI verifies both promoted tags, creates or verifies the GitHub release, and retains a bounded set of SHA image versions.
7. A rerun for the same commit reuses its assigned release version and cannot consume another patch number.

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
docker compose -f compose.raspberry.yml up -d --force-recreate basketra
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

On mobile, swiping right marks a product bought. A short left swipe reveals edit and delete controls. Continuing to the red threshold deletes on release and immediately offers Undo. Equivalent visible controls remain available for keyboard, switch, simple-pointer, and assistive-technology users; deletion through a button still uses confirmation.

## Receipt workflow

1. Capture a photo with the rear-camera hint or choose JPEG, PNG, or PDF files.
2. Validate type, size, body, signature, and storage key.
3. Review persistent image thumbnails or PDF placeholders.
4. Reorder or remove captures from the draft without deleting original evidence.
5. Run local Spanish OCR for JPEG or PNG images.
6. Optionally verify extracted text with a configured AI provider.
7. Edit product, quantity, unit price, and line total directly in rows expressed as euros.
8. Add or remove manual rows and validate the declared euro total.
9. Confirm the idempotent import.

The browser never asks users to enter integer cents. `0.20 €` is entered as `0.20` or `0,20`; the backend remains authoritative and stores money as integer minor units.

Local OCR is single-threaded and serialized. It runs as an ephemeral process with a fixed command, timeout, cancellation, and output bounds. OCR content, filenames, filesystem paths, and raw process output are not logged.

Local OCR does not rasterize PDFs. A PDF requires a configured PDF-capable provider or manual editable rows. Any OCR or provider failure preserves the capture draft and existing corrections.

Stored image previews are served from `/api/v1/files/<storage-key>` with strict storage-key validation and `Cache-Control: private, no-store`. PDF content is not exposed through the image-preview route. The service worker excludes all `/api/` requests.

## Runtime operations

Settings exposes operational state without revealing process environment or arbitrary host logs:

- deployed semantic version and immutable revision;
- server start time and a live uptime counter derived locally from that timestamp;
- RSS memory snapshot;
- AI configuration state, loopback-in-container warning, and an explicit synthetic-image plus strict-JSON capability probe;
- bounded structured client and server application events;
- portable backup creation, optional direct download, validated import, and staged restore.

The private-route heartbeat runs slowly while healthy, retries quickly while disconnected, pauses while the document is hidden, and ignores stale responses. A VPN route restoration updates the connection chip and refreshes operational state without a page reload or a browser `online` event.

Application logs use NDJSON under the persistent data volume. Rotation defaults to 10,000 lines or 40 MiB per active file, with a bounded archive count. Client events are untrusted and pass through a closed server-side schema, field-size caps, batch caps, and rate limiting. Receipt text, uploaded filenames, request bodies, headers, credentials, provider responses, and filesystem paths are never accepted as client log fields.

## Data, backup, and restore

Persistent data lives in `basketra-data`. Settings can create a portable backup and then leaves the download decision to the operator. The API equivalents remain available through the trusted private path:

```bash
curl --fail --request POST http://127.0.0.1:3000/api/v1/backup \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-manual.db"}'

curl --fail --output basketra-manual.db \
  http://127.0.0.1:3000/api/v1/backups/basketra-manual.db
```

Imported `.db` files are staged separately and must pass SQLite integrity and supported-schema validation. Restore requires the exact confirmation phrase shown in Settings. Basketra creates a portable pre-restore backup, writes an atomic pending marker, exits cleanly, validates the imported database again during startup, and only then replaces the inactive primary database. A failed startup restore preserves the current database and moves the marker aside to prevent a restart loop.

See [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md). A named Docker volume is not an independent disaster-recovery copy; export important backups to separately managed storage.

## Optional AI provider configuration

Local image OCR needs no provider. Configure an OpenAI-compatible service only for optional text verification, list assistance, or provider-dependent PDF OCR. Every environment entry must be on its own line.

For a provider listening on the Raspberry host at port 3001:

```dotenv
BASKETRA_AI_BASE_URL=http://host.docker.internal:3001/v1/
BASKETRA_AI_API_KEY=<managed-webapi-token>
BASKETRA_AI_MODEL=default
BASKETRA_AI_MAX_RETRIES=1
BASKETRA_AI_IMAGE_CAPABILITY=true
BASKETRA_AI_PDF_CAPABILITY=false
```

When the provider is webApi, create a database-backed managed token from webApi `/admin` and copy its one-time value into `BASKETRA_AI_API_KEY`. The removed webApi `API_KEY` environment variable is not supported and must not be recreated. Basketra masks the configured token in Settings and never sends it to the browser.

### AI connectivity check

The Settings action is a real end-to-end provider check, not a health check. It sends one `POST /v1/chat/completions` request through Basketra's canonical provider client. For webApi, the request is `multipart/form-data`: a JSON `request` field contains the OpenAI-compatible model, messages, and strict response schema, while exactly one `files` part contains the checked-in JPEG bytes. The image is a compact, non-user fixture named `test.jpg`; its filename and prompt do not disclose the text the model must read.

Basketra builds the multipart request from the fixture's binary bytes. It does not put a base64 or data URL copy in the JSON field, set a competing `Content-Type`, or configure a separate attachment-size limit. The fetch runtime supplies the multipart boundary and framing. When webApi exposes `/v1/capabilities`, Basketra checks that endpoint's attachment and request budgets before uploading; webApi remains authoritative for validation and limits.

The provider must return the requested strict JSON object and the image text must match the visible fixture text exactly. Therefore a successful provider discovery or `GET /v1/models` response is not proof that authentication, binary attachment handling, model routing, image processing, and structured output work together.

There is no `BASKETRA_AI_TIMEOUT_MS` setting. Basketra does not impose a wall-clock timeout on AI inference: the provider/upstream owns that deadline. An abandoned browser request is still cancelled, and the manual connectivity check does not retry automatically.

Settings reports safe, actionable outcomes without showing credentials, headers, image data, or raw provider responses. It distinguishes missing configuration, Docker-loopback configuration, connection failure, provider timeout, authentication failure, attachment-size or upload failure, request/schema rejection, rate limiting, invalid or empty structured output, oversized response, and provider failure. A failed check preserves the configured values and can be retried manually.

### Test levels

The repository's normal test suite is deterministic and uses a local mock provider; it does not call a live AI service. Run the focused provider contracts with:

```bash
node --experimental-strip-types --test \
  tests/unit/ai-provider-errors.test.ts \
  tests/unit/ai-runtime-capabilities.test.ts \
  tests/unit/provider-probe-contract.test.ts
pnpm test:integration
pnpm quality
```

There is no unattended live-provider smoke command or required CI job. To perform the optional live check, configure a private webApi-compatible provider in the deployment environment, recreate Basketra, then use **Test AI provider** in Settings. Treat that manual result as operational evidence only; do not add credentials or live-provider calls to CI.

`127.0.0.1` inside the Basketra container refers to Basketra itself, not to the Raspberry host. `compose.raspberry.yml` maps `host.docker.internal` to Docker's host gateway. After changing `.env`, validate and recreate the service so Docker injects the new values:

```bash
docker compose -f compose.raspberry.yml config --quiet
docker compose -f compose.raspberry.yml up -d --force-recreate basketra
```

Settings distinguishes configuration that is missing, loaded with an invalid container-loopback address, unreachable, rejected by authentication, rejected while preparing an attachment, or unable to satisfy strict structured output. The browser never receives the provider key; it may display only the last four masked characters. Provider URLs are administrative environment configuration, never request input. Structured results are validated locally before use.

The only accepted deployment resource names are `BASKETRA_BIND_ADDRESS`, `BASKETRA_MEMORY_LIMIT`, and `BASKETRA_CPU_LIMIT`. The aliases `BASKETRA_BIND_IP`, `BASKETRA_MEM_LIMIT`, and `BASKETRA_CPUS` are not read. `BASKETRA_AUTH_TOKEN` was removed and must not be restored.

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
