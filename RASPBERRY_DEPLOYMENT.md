# Private Raspberry Pi deployment

This runbook deploys Basketra from the private multi-architecture image `ghcr.io/juanjogondev/basketra`.

## Supported boundary

Basketra is a single-user private application. It has no internal application login or access token. The repository-owned production Compose file publishes Basketra only on `127.0.0.1:3000` and is intended to be reached through a trusted VPN, SSH tunnel, reviewed LAN-only route, or authenticated private reverse proxy.

Anyone who can reach the Basketra HTTP service can access lists, receipts, diagnostics, logs, backups, and administrative restore operations. Direct public Internet exposure is unsupported.

Basketra application settings are not configured through environment variables. There is no required `.env` file.

## Requirements

- Raspberry Pi OS or another Linux ARM64 distribution;
- Docker Engine with the Compose plugin;
- access to the private GHCR package;
- a private access path such as WireGuard, SSH forwarding, or an authenticated private reverse proxy;
- enough disk capacity for bounded application data, backups, and retained container images.

## Authenticate to private GHCR

The host needs a GitHub credential limited to `read:packages`. The optional Watchtower service mounts repository-local `./.docker` as its Docker client configuration, so authenticate into that directory rather than placing credentials in Compose or a Basketra environment file:

```bash
mkdir -p .docker
chmod 700 .docker
read -rsp 'GHCR read token: ' CR_PAT
echo
printf '%s' "$CR_PAT" | docker --config "$PWD/.docker" login ghcr.io -u juanjoGonDev --password-stdin
unset CR_PAT
chmod 600 .docker/config.json
```

Do not paste registry credentials into chat, screenshots, logs, Compose files, or this repository.

## Validate and start Basketra

No `.env` preparation is required:

```bash
docker compose -f compose.raspberry.yml config --quiet
docker compose -f compose.raspberry.yml pull basketra
docker compose -f compose.raspberry.yml up -d basketra
docker compose -f compose.raspberry.yml ps
curl --fail --silent http://127.0.0.1:3000/health
curl --fail --silent http://127.0.0.1:3000/readiness
curl --fail --silent http://127.0.0.1:3000/api/v1/runtime
```

The reviewed production service contract is encoded directly in `compose.raspberry.yml`:

- image `ghcr.io/juanjogondev/basketra:stable`;
- host loopback publication on port 3000;
- `basketra-data` persistent volume;
- host gateway alias `host.docker.internal`;
- 128 MiB Node heap;
- 192 MiB memory and swap cap;
- 0.75 CPU and 128 PID cap;
- read-only root filesystem;
- all Linux capabilities dropped;
- `no-new-privileges`;
- bounded tmpfs and Docker logs;
- readiness health check and bounded shutdown grace period.

These are deployment-code controls, not mutable application settings.

## Configure Basketra from Settings

After Basketra is ready, open **Ajustes**. Mutable values are persisted in the Basketra SQLite database and apply to subsequent operations without restarting or recreating the container:

- WebAPI URL;
- optional WebAPI managed token;
- model;
- maximum AI retries;
- Overpass URL;
- local request-body limit;
- idle hibernation delay.

The WebAPI token is write-only. The browser receives only a configured flag and a mask. Leaving the token input empty preserves the stored value; the explicit delete control removes it.

A portable Basketra database backup therefore contains runtime settings and may contain the WebAPI token. Treat backups as private operational data.

## Configure WebAPI / AI

Local JPEG/PNG OCR does not require AI. An OpenAI-compatible service is needed only for optional AI workflows or provider-dependent PDF OCR.

If WebAPI runs on the Raspberry host at port 3001, set this in **Ajustes → IA**:

- URL: `http://host.docker.internal:3001/v1/`
- model: the WebAPI model you intend to use, for example `default`;
- token: a managed WebAPI token only when authentication is enabled;
- retry count: the desired bounded retry count.

Inside the Basketra container, `127.0.0.1` is Basketra itself. `compose.raspberry.yml` maps `host.docker.internal` to Docker's host gateway. If WebAPI runs on another trusted machine, use its private LAN/VPN address instead.

WebAPI must listen on an interface reachable from Basketra and its firewall should restrict access to the required private source. Do not expose WebAPI publicly just to make Basketra reach it.

### Capability and attachment contract

WebAPI is authoritative for provider capabilities and AI attachment limits. Basketra reads `/v1/capabilities` and does not define a competing AI attachment-size policy. A temporary capability-endpoint failure may use only the last validated WebAPI capability snapshot persisted in Basketra SQLite; authentication failures remain explicit.

For the manual connectivity check, Basketra sends one repository-owned JPEG as `multipart/form-data`: OpenAI-compatible JSON metadata goes in `request`, while the JPEG bytes go once in `files`. For durable receipt `/v1/responses`, original receipt attachments are likewise binary multipart rather than Base64-expanded JSON.

The manual Settings check verifies authentication, model routing, binary attachment handling, image processing, and strict structured output together. Its result is redacted; the raw token, headers, fixture bytes, and provider response bodies are never returned to the browser.

There is no Basketra AI inference timeout setting. WebAPI/upstream owns provider timeout policy. Receipt verification still has its own bounded workflow deadline and caller cancellation remains terminal.

## Verify private access

On the Raspberry:

```bash
ss -ltn | grep ':3000'
curl --fail --silent http://127.0.0.1:3000/readiness
```

From an untrusted path, port 3000 must not be directly reachable. Remote access should terminate at one of the reviewed boundaries:

- VPN interface with controlled membership;
- SSH local port forwarding;
- reverse proxy with TLS and authentication;
- explicitly reviewed LAN-only interface with firewall rules.

Do not rely on obscurity, a non-standard port, or browser storage as an access control.

## Runtime verification

Inspect the application without dumping container environment/configuration:

```bash
docker compose -f compose.raspberry.yml ps
docker compose -f compose.raspberry.yml logs --tail 100 basketra
docker inspect --format '{{json .State.Health}}' basketra-basketra-1
docker stats --no-stream basketra-basketra-1
curl --fail --silent http://127.0.0.1:3000/api/v1/runtime
```

`/health` proves HTTP liveness. `/readiness` proves database initialization/migrations have completed. `/api/v1/runtime` exposes version, revision, start time, and uptime without exposing credentials or arbitrary process data.

## Application logs

Settings displays the bounded Basketra application event stream. Only allowlisted operational metadata is accepted from browser/server sources. Receipt text, filenames, database content, request bodies, provider responses, headers, credentials, arbitrary messages, and filesystem paths are excluded.

Application logs are NDJSON under `/data/logs`. The active file defaults to a 10,000-line or 40 MiB limit with bounded archives. Docker `json-file` logs remain a separate source for startup, shutdown, native crashes, and restore failures.

## VPN/private-route recovery

The browser uses a visibility-aware private-route heartbeat rather than trusting only `navigator.onLine`:

- slow checks while healthy;
- fast bounded checks while disconnected;
- no active checks while hidden;
- request timeout and stale-response suppression;
- state refresh after the private route returns.

After reconnecting the VPN, the header should return to **Conectado** without a page reload.

## Backup and staged restore

Settings can:

1. create a portable SQLite backup;
2. optionally download it;
3. import a candidate `.db`;
4. validate SQLite integrity and schema compatibility;
5. stage restore after the exact confirmation phrase.

A staged restore creates a pre-restore backup, writes an atomic pending marker, returns success, stops Basketra cleanly, revalidates the candidate before opening the primary database on startup, and replaces the inactive primary only after validation. Failed startup restore preserves the prior database and moves the failed marker aside to prevent a restart loop.

The database-only restore does not replace `/data/files`. Preserve receipt evidence files together with compatible database backups for full disaster recovery. See [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md).

Manual backup API equivalents on the trusted private path:

```bash
curl --fail --request POST http://127.0.0.1:3000/api/v1/backup \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-manual.db"}'

curl --fail --output basketra-manual.db \
  http://127.0.0.1:3000/api/v1/backups/basketra-manual.db
```

Never copy over an active SQLite database.

## Storage and migrations

Before listening, Basketra checkpoints WAL, creates/validates bounded pre-migration backup state when needed, applies pending migrations transactionally, and validates the target database.

Current default storage guards include:

- primary SQLite database: 512 MiB maximum;
- SQLite cache: 8 MiB;
- WAL target: 16 MiB;
- migration backups: newest 3, maximum 768 MiB combined;
- manual/pre-restore backups: newest 5, maximum 768 MiB combined;
- deduplicated receipt files: 512 MiB maximum.

Applied migrations are immutable. Repeated failed migrations cannot create unlimited backups. No deployment variable bypasses destructive-migration guards.

## Verified publication

Trusted `main` publication:

1. resolves the deterministic patch version;
2. publishes a full-SHA multi-architecture candidate;
3. verifies digest and runnable AMD64/ARM64 manifests;
4. runs that exact digest under production restrictions;
5. verifies readiness, version, resource bounds, and shutdown;
6. promotes the identical digest to `stable` and its immutable numeric version;
7. verifies promoted manifests and the GitHub release;
8. retains a bounded set of immutable SHA versions.

Inspect a release with:

```bash
COMMIT_SHA=<full-commit-sha>
docker buildx imagetools inspect "ghcr.io/juanjogondev/basketra:${COMMIT_SHA}"
docker pull "ghcr.io/juanjogondev/basketra:${COMMIT_SHA}"
docker pull ghcr.io/juanjogondev/basketra:stable
```

## Explicit image rollback

Do not use an environment-variable image override. Pin a retained immutable SHA or numeric version in a reviewed local Compose override, for example `compose.rollback.yml`:

```yaml
services:
  basketra:
    image: ghcr.io/juanjogondev/basketra:<previous-full-sha-or-version>
```

Then:

```bash
docker compose -f compose.raspberry.yml -f compose.rollback.yml pull basketra
docker compose -f compose.raspberry.yml -f compose.rollback.yml up -d --no-deps --force-recreate basketra
curl --fail --silent http://127.0.0.1:3000/readiness
curl --fail --silent http://127.0.0.1:3000/api/v1/runtime
```

Remove the override only after the newer release is confirmed safe. If application rollback crosses a schema incompatibility, restore the matching validated pre-migration backup instead of attempting unsupported schema reversal.

## Scoped Watchtower

The optional `autoupdate` profile uses Watchtower 1.7.1 with fixed Compose-owned controls:

- scope `basketra`;
- label filtering enabled;
- 300-second polling;
- old image cleanup enabled;
- volume removal disabled;
- bounded memory, CPU, PID, tmpfs, and Docker logs.

It mounts `/var/run/docker.sock` read-only and repository-local `./.docker` as `/config`. Authenticate that directory as described above before enabling the profile.

Before starting it, inspect any existing Watchtower attached to the same Docker daemon. An unscoped/global Watchtower can conflict with the scoped Basketra instance and must be reviewed separately; this repository does not mutate that external host configuration.

After that review:

```bash
docker compose -f compose.raspberry.yml --profile autoupdate up -d watchtower
docker compose -f compose.raspberry.yml logs --tail 100 watchtower
```

Do not combine a cron schedule with the fixed poll interval. Application volumes must never be deleted by Watchtower cleanup.
