# Private Raspberry Pi deployment

This runbook deploys Basketra from the private multi-architecture image `ghcr.io/juanjogondev/basketra`. Docker repository references are lowercase even though the account display name is `juanjoGonDev`.

Basketra is a single-installation private application. It has no internal application token or login screen. The default deployment publishes only on host loopback and must be reached through a VPN, SSH tunnel, reviewed LAN-only route, or authenticated private reverse proxy.

Anyone who can reach the Basketra HTTP service can access lists, receipts, diagnostics, logs, backups, and administrative restore operations. Direct public internet exposure is unsupported.

## Requirements

- Raspberry Pi OS or another Linux ARM64 distribution.
- Docker Engine with the Compose plugin.
- Access to the private GHCR package.
- A private access path such as WireGuard, an SSH tunnel, or an authenticated private reverse proxy.
- Free disk capacity for bounded application data plus at least two image revisions.

Keep `BASKETRA_BIND_ADDRESS=127.0.0.1` unless a reviewed LAN-only bind and firewall policy are intentionally configured. Do not expose the port directly on a public interface.

## Authenticate to private GHCR

Use a GitHub credential limited to `read:packages` on the deployment host. Do not place it in `.env`, Compose, shell history, or this repository.

```bash
read -rsp 'GHCR read token: ' CR_PAT
echo
printf '%s' "$CR_PAT" | docker login ghcr.io -u juanjoGonDev --password-stdin
unset CR_PAT
```

Protect Docker's client configuration with owner-only permissions. The optional Watchtower service receives that directory through `BASKETRA_DOCKER_CONFIG_DIR`.

## Create the deployment environment

```bash
umask 077
cp .env.example .env
chmod 600 .env
```

Every variable must be on a separate line. Compose recognizes these canonical resource names:

- `BASKETRA_BIND_ADDRESS`, not `BASKETRA_BIND_IP`;
- `BASKETRA_MEMORY_LIMIT`, not `BASKETRA_MEM_LIMIT`;
- `BASKETRA_CPU_LIMIT`, not `BASKETRA_CPUS`.

`BASKETRA_AUTH_TOKEN` was removed from the application. Do not add it back; the access boundary is the private network path.

Keep these defaults unless measurements or network design justify a reviewed change:

```dotenv
BASKETRA_IMAGE=ghcr.io/juanjogondev/basketra:stable
BASKETRA_BIND_ADDRESS=127.0.0.1
BASKETRA_PORT=3000
BASKETRA_NODE_HEAP_MB=128
BASKETRA_MEMORY_LIMIT=192m
BASKETRA_CPU_LIMIT=0.75
WATCHTOWER_POLL_INTERVAL=300
WATCHTOWER_MEMORY_LIMIT=128m
TZ=Europe/Madrid
```

Compose sets memory and swap to the same limit, caps PIDs and CPU, uses bounded tmpfs mounts, and rotates each Docker service log at three 5 MiB files. Provider credentials remain optional. Never commit a real `.env` or registry credential.

## Configure a provider running on the Raspberry host

Local JPEG/PNG OCR does not require AI. An OpenAI-compatible provider is only needed for optional verification, list assistance, or provider-dependent PDF processing.

Inside the Basketra container, `127.0.0.1` means the Basketra container itself. It does not reach a process listening on the Raspberry host. `compose.raspberry.yml` maps `host.docker.internal` to Docker's host gateway, so the canonical configuration for a provider on host port 3001 is:

```dotenv
BASKETRA_AI_BASE_URL=http://host.docker.internal:3001/v1/
BASKETRA_AI_API_KEY=<managed-webapi-token>
BASKETRA_AI_MODEL=default
BASKETRA_AI_MAX_RETRIES=1
BASKETRA_AI_IMAGE_CAPABILITY=true
BASKETRA_AI_PDF_CAPABILITY=false
```

For webApi, create a database-backed managed token in webApi `/admin` and copy the one-time token value into `BASKETRA_AI_API_KEY`. The removed webApi `API_KEY` environment variable is not a valid credential and must not be restored. Do not paste the managed token into chat, screenshots, shell history, logs, or this runbook.

The provider itself must listen on an address reachable from Docker's bridge, not exclusively on host loopback, and its firewall must allow only the required local bridge/private source. Do not publish the provider to the public Internet.

Changing `.env` does not alter an existing container. Validate the resolved configuration and recreate Basketra:

```bash
docker compose -f compose.raspberry.yml config --quiet
docker compose -f compose.raspberry.yml up -d --force-recreate basketra
docker compose -f compose.raspberry.yml ps
```

Do not use `docker inspect` formats that dump the full environment. The Basketra Settings page shows whether configuration is missing, loaded with a Docker-loopback error, unreachable, rejected by authentication, rejected while preparing an image, or unable to satisfy strict structured output. It returns only the provider URL, model, capabilities, and an optional last-four mask; it never returns the token.

The Settings verification action performs one manual `POST /v1/chat/completions` request through Basketra's canonical provider client. For webApi, it sends `multipart/form-data`: the `request` field holds the OpenAI-compatible JSON request and strict response schema, and one `files` part holds a compact repository-owned JPEG fixture. The generic filename is `test.jpg`; neither the filename nor the prompt reveals the text the provider must read. Basketra sends the JPEG binary once, without a base64/data-URL duplicate in request JSON, and lets the fetch runtime generate multipart framing.

The provider must both process the image and return the requested strict JSON object with the expected visible text. A successful `GET /v1/models` call therefore does not prove that the managed token, binary attachment transport, composer readiness, selected model, image processing, and Structured Outputs work together.

`BASKETRA_AI_TIMEOUT_MS` is not a supported setting. Basketra does not apply an inference wall-clock timeout; webApi/the upstream provider owns that timeout. A browser-disconnected request is still cancelled and the manual test does not retry automatically.

The Settings result is safe to share only as its stable outcome code. It distinguishes missing configuration, container-loopback configuration, unreachable provider, authentication failure, provider timeout, attachment too large, attachment upload failure, request/schema rejection, rate limiting, invalid or empty structured output, response too large, and provider failure. It never returns the managed token, request headers, fixture bytes, or raw provider response. Correct the configuration or provider condition and run the manual check again.

Deterministic repository checks use a local mock provider; no required CI job contacts a live AI service. There is no unattended live-provider smoke command. After configuring a private provider and recreating the container, use **Test AI provider** in Settings as the optional operational smoke check. Do not put a real token or live-provider invocation in CI.

After a credential has appeared in chat, screenshots, shell history, or logs, revoke and replace it before restarting the service.

## Verify the private image pull and version

After an approved merge, inspect and pull the immutable candidate before relying on `stable`:

```bash
COMMIT_SHA=<full-commit-sha>
docker buildx imagetools inspect "ghcr.io/juanjogondev/basketra:${COMMIT_SHA}"
docker pull "ghcr.io/juanjogondev/basketra:${COMMIT_SHA}"
docker pull ghcr.io/juanjogondev/basketra:stable
```

Validate the production Compose reference:

```bash
docker compose -f compose.raspberry.yml config --quiet
docker compose -f compose.raspberry.yml pull basketra
docker image inspect ghcr.io/juanjogondev/basketra:stable \
  --format '{{index .RepoDigests 0}} {{index .Config.Labels "org.opencontainers.image.version"}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
docker compose -f compose.raspberry.yml images
```

Each trusted main publication receives one semantic version. The first release is `1.0.0`; later releases increment only the patch component. The same version is embedded in the application, OCI labels, immutable numeric image tag, and GitHub release. A workflow rerun for the same commit reuses its assigned version.

## Start Basketra

```bash
docker compose -f compose.raspberry.yml up -d --force-recreate basketra
docker compose -f compose.raspberry.yml ps
curl --fail --silent http://127.0.0.1:3000/health
curl --fail --silent http://127.0.0.1:3000/readiness
curl --fail --silent http://127.0.0.1:3000/api/v1/runtime
```

`/health` confirms HTTP liveness. `/readiness` confirms database initialization and migrations completed. `/api/v1/runtime` exposes the deployed version, revision, start timestamp, and current uptime without exposing the environment.

Inspect startup without printing the environment:

```bash
docker compose -f compose.raspberry.yml logs --tail 100 basketra
docker inspect --format '{{json .State.Health}}' basketra-basketra-1
docker stats --no-stream basketra-basketra-1
```

## Application logs and Docker logs

Settings displays the bounded Basketra application event stream. It contains allowlisted operational metadata from server and browser sources: event, level, timestamp, request identifier, method, path without query, status, duration, and stable error code.

It deliberately excludes receipt text, filenames, database content, request bodies, provider responses, headers, credentials, arbitrary client messages, and filesystem paths. Client logs are untrusted and are schema-validated, size-capped, batch-capped, and rate-limited before storage.

Application logs are stored under `/data/logs` as NDJSON. Rotation defaults to 10,000 lines or 40 MiB for the active file and removes oldest archives first. Docker's `json-file` logs remain a separate process-level source for startup, shutdown, native crashes, and restore failures:

```bash
docker compose -f compose.raspberry.yml logs --tail 100 basketra
```

Do not copy the complete data volume or raw Docker configuration into a support ticket.

## VPN and private-route recovery

The browser does not rely only on `navigator.onLine`, because a VPN route can disappear while the device remains connected to another network. Basketra uses a visibility-aware heartbeat:

- slow checks while healthy;
- fast bounded retries while disconnected;
- no active checks while the page is hidden;
- request timeout and stale-response suppression;
- operational refresh when the private route returns.

After reconnecting the VPN, the header should return to **Conectado** without a reload. A server restart caused by a staged restore uses the same recovery path.

## Verify the private access boundary

On the Raspberry Pi, the service should answer on the intended private bind:

```bash
ss -ltn | grep ':3000'
curl --fail --silent http://127.0.0.1:3000/readiness
```

From an untrusted network path, the port must not be reachable. Remote access must terminate at one of these reviewed boundaries:

- VPN interface with controlled membership;
- SSH local port forwarding;
- reverse proxy with TLS and authentication;
- LAN-only interface protected by firewall rules.

Do not rely on obscurity, a non-standard port, or browser storage as an access control.

## Backup download, import, and staged restore

Settings can create a portable SQLite backup and then offers a separate download action. It can also import a local `.db`, validate integrity and schema compatibility, and stage a restore after the exact confirmation phrase is entered.

A staged restore:

1. creates a portable pre-restore backup;
2. writes an atomic pending marker;
3. returns a successful response;
4. stops Basketra cleanly;
5. revalidates and applies the candidate before opening SQLite on restart;
6. preserves the prior database if any validation or replacement step fails;
7. moves a failed marker aside to prevent an automatic restart loop.

The database-only restore does not replace `/data/files`. Preserve receipt evidence files together with compatible database backups for complete disaster recovery. See [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md).

Manual API equivalents:

```bash
curl --fail --request POST http://127.0.0.1:3000/api/v1/backup \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-manual.db"}'

curl --fail --output basketra-manual.db \
  http://127.0.0.1:3000/api/v1/backups/basketra-manual.db
```

## Automatic migrations and storage retention

Before listening, Basketra checkpoints WAL, reserves room under count and byte retention budgets, creates and validates an atomic standalone pre-migration backup, applies the complete pending batch transactionally, and validates the target database before commit.

Defaults:

- primary SQLite database: 512 MiB maximum;
- SQLite cache: 8 MiB;
- WAL target: 16 MiB;
- migration backups: newest 3, maximum 768 MiB combined;
- manual and pre-restore backups: newest 5, maximum 768 MiB combined;
- deduplicated receipt files: 512 MiB maximum.

Schema migration 3 adds shopping-list completion state and completion timestamps without rewriting existing migrations. Existing list items remain pending after upgrade.

Repeated failed migrations cannot create unlimited backups. Failed temporary copies are removed. A destructive migration requires explicit code-level authorization; no deployment variable bypasses that guard.

## Offline restore

Use the offline procedure for full-volume recovery, large databases, or an application that cannot start:

```bash
docker compose -f compose.raspberry.yml stop basketra
docker compose -f compose.raspberry.yml run --rm --no-deps \
  --env RESTORE_NAME=basketra-manual.db \
  --entrypoint /bin/sh basketra -eu -c '
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    cp /data/basketra.db "/data/backups/pre-restore-${timestamp}.db"
    cp "/data/backups/${RESTORE_NAME}" /data/basketra.db
    rm -f /data/basketra.db-wal /data/basketra.db-shm
  '
docker compose -f compose.raspberry.yml up -d basketra
curl --fail --silent http://127.0.0.1:3000/readiness
```

Never copy over an active SQLite database. Preserve `/data/files` and verify critical receipts after recovery.

## Verified publication and image rollback

An approved merge does not immediately move `stable`. The main workflow:

1. resolves the deterministic patch version;
2. publishes only a full-SHA multi-architecture candidate with version/revision metadata;
3. verifies its registry digest and runnable AMD64/ARM64 entries;
4. pulls and runs the exact digest under production limits;
5. verifies readiness, runtime version, bounded shutdown, and zero exit status;
6. promotes the identical digest to `stable` and the numeric version tag without rebuilding;
7. verifies both promoted manifests;
8. creates or verifies the matching GitHub release;
9. retains the newest ten immutable SHA image versions.

A candidate that fails before promotion is deleted. Set a previous retained SHA or numeric version in `.env` for rollback:

```dotenv
BASKETRA_IMAGE=ghcr.io/juanjogondev/basketra:<previous-full-commit-sha-or-version>
```

```bash
docker compose -f compose.raspberry.yml pull basketra
docker compose -f compose.raspberry.yml up -d --no-deps --force-recreate basketra
curl --fail --silent http://127.0.0.1:3000/readiness
curl --fail --silent http://127.0.0.1:3000/api/v1/runtime
```

An immutable SHA or numeric version tag does not move. Return to `stable` only after the release is known good. A schema-incompatible application rollback may also require restoring its validated pre-migration backup.

## Scoped Watchtower every five minutes

The optional `autoupdate` profile uses Watchtower `1.7.1`, `WATCHTOWER_SCOPE=basketra`, enable-label filtering, and a 300-second interval. It removes superseded local image data after a successful update but sets `WATCHTOWER_REMOVE_VOLUMES=false`; application volumes must never be deleted by cleanup.

Before starting it, inspect every Watchtower attached to the daemon:

```bash
docker ps --filter name=watchtower --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect --format '{{json .Config.Cmd}} {{json .Config.Env}} {{json .Config.Labels}}' watchtower
```

An unscoped Watchtower can conflict with another instance. The existing `raspberry5` convention includes a global Watchtower, so do not start Basketra's instance until that global configuration has been reviewed without affecting other containers. This repository does not alter the Raspberry host.

After that separate review:

```bash
docker compose -f compose.raspberry.yml --profile autoupdate up -d watchtower
docker compose -f compose.raspberry.yml logs --tail 100 watchtower
```

Never combine `WATCHTOWER_SCHEDULE` and `WATCHTOWER_POLL_INTERVAL`. Watchtower upstream is archived; `1.7.1` remains pinned because the existing host standardizes on it. Evaluate a maintained replacement before expanding its responsibility.

## Routine diagnostics

```bash
docker compose -f compose.raspberry.yml pull basketra
docker compose -f compose.raspberry.yml up -d --force-recreate basketra
docker compose -f compose.raspberry.yml ps
docker compose -f compose.raspberry.yml logs --tail 100 basketra
curl --fail --silent http://127.0.0.1:3000/readiness
curl --fail --silent http://127.0.0.1:3000/api/v1/runtime
```

Do not print `.env`, Docker registry configuration, container environment, receipt content, backup bytes, or provider credentials into tickets, CI logs, support output, or screenshots.
