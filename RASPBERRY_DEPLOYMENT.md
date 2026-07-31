# Private Raspberry Pi deployment

This runbook deploys Basketra from the private multi-architecture image `ghcr.io/juanjogondev/basketra`. Docker repository references are lowercase even though the account display name is `juanjoGonDev`.

Basketra is a single-installation private application. It has no internal application token or login screen. The default deployment publishes only on host loopback and must be reached through a VPN, SSH tunnel, reviewed LAN-only route, or authenticated private reverse proxy.

Anyone who can reach the Basketra HTTP service can access lists, receipts, diagnostics, backups, and administrative API operations. Direct public internet exposure is unsupported.

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

Review `.env` without adding application credentials. Keep these defaults unless measurements or network design justify a reviewed change:

- `BASKETRA_IMAGE=ghcr.io/juanjogondev/basketra:stable`
- `BASKETRA_BIND_ADDRESS=127.0.0.1`
- `BASKETRA_NODE_HEAP_MB=128`
- `BASKETRA_MEMORY_LIMIT=192m`
- `BASKETRA_CPU_LIMIT=0.75`
- `WATCHTOWER_POLL_INTERVAL=300`
- `WATCHTOWER_MEMORY_LIMIT=128m`
- `TZ=Europe/Madrid`

Compose sets memory and swap to the same limit, caps PIDs and CPU, uses bounded tmpfs mounts, and rotates each service log at three 5 MiB files. AI provider credentials remain optional. Never commit a real `.env` or registry credential.

## Verify the private image pull

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
  --format '{{index .RepoDigests 0}}'
docker compose -f compose.raspberry.yml images
```

A successful authenticated pull and non-empty repository digest confirm registry access. Keep the GHCR package private and linked to `juanjoGonDev/Basketra`.

## Start Basketra

```bash
docker compose -f compose.raspberry.yml up -d basketra
docker compose -f compose.raspberry.yml ps
curl --fail --silent http://127.0.0.1:3000/health
curl --fail --silent http://127.0.0.1:3000/readiness
```

`/health` confirms HTTP liveness. `/readiness` confirms database initialization and migrations completed. Migration, backup-retention, database-size, or existing-file-budget failures prevent the service from becoming healthy.

Inspect startup without printing the environment:

```bash
docker compose -f compose.raspberry.yml logs --tail 100 basketra
docker inspect --format '{{json .State.Health}}' basketra-basketra-1
docker stats --no-stream basketra-basketra-1
```

Do not use inspection formats that dump the full environment.

## Verify the private access boundary

On the Raspberry Pi, the service should answer on loopback:

```bash
ss -ltn | grep ':3000'
curl --fail --silent http://127.0.0.1:3000/readiness
```

From an untrusted network path, port 3000 must not be reachable. Remote access must terminate at one of these reviewed boundaries:

- VPN interface with controlled membership;
- SSH local port forwarding;
- reverse proxy with TLS and authentication;
- LAN-only interface protected by firewall rules.

Do not rely on obscurity, a non-standard port, or browser storage as an access control.

## Automatic migrations and storage retention

Before listening, Basketra checkpoints WAL, reserves room under count and byte retention budgets, creates and validates an atomic standalone pre-migration backup, applies the complete pending batch transactionally, and validates the target database before commit.

Defaults:

- primary SQLite database: 512 MiB maximum;
- SQLite cache: 8 MiB;
- WAL target: 16 MiB;
- migration backups: newest 3, maximum 768 MiB combined;
- manual backups: newest 5, maximum 768 MiB combined;
- deduplicated receipt files: 512 MiB maximum.

Schema migration 3 adds shopping-list completion state and completion timestamps without rewriting existing migrations. Existing list items remain pending after upgrade.

Repeated failed migrations cannot create unlimited backups. Failed temporary copies are removed. A destructive migration requires explicit code-level authorization; no deployment variable bypasses that guard.

## Manual backup and validation

Run administrative API calls only through the trusted private access path:

```bash
curl --fail --request POST http://127.0.0.1:3000/api/v1/backup \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-manual.db"}'

curl --fail --request POST http://127.0.0.1:3000/api/v1/restore/validate \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-manual.db"}'
```

Copy important backups out of the named volume before retention removes older local copies.

## Restore a validated backup

Restoration is deliberately offline:

```bash
curl --fail --request POST http://127.0.0.1:3000/api/v1/restore/validate \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-manual.db"}'

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

If readiness fails, stop the service and restore the preserved database. Never copy over an active SQLite database. Move or remove the emergency `pre-restore` copy after recovery.

## Verified publication and image rollback

An approved merge does not immediately move `stable`. The main workflow:

1. publishes only a full-SHA multi-architecture candidate;
2. verifies its registry digest and runnable AMD64/ARM64 entries;
3. pulls and runs the exact digest under production limits;
4. requires readiness, bounded shutdown, and zero exit status;
5. promotes the identical digest to `stable` without rebuilding;
6. verifies `stable` and retains the newest ten immutable SHA releases.

A candidate that fails before promotion is deleted. Set a previous retained SHA in `.env` for rollback:

```dotenv
BASKETRA_IMAGE=ghcr.io/juanjogondev/basketra:<previous-full-commit-sha>
```

```bash
docker compose -f compose.raspberry.yml pull basketra
docker compose -f compose.raspberry.yml up -d --no-deps basketra
curl --fail --silent http://127.0.0.1:3000/readiness
```

An immutable SHA tag does not move. Return to `stable` only after the release is known good. A schema-incompatible application rollback may also require restoring its validated pre-migration backup.

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
docker compose -f compose.raspberry.yml up -d basketra
docker compose -f compose.raspberry.yml ps
docker compose -f compose.raspberry.yml logs --tail 100 basketra
curl --fail --silent http://127.0.0.1:3000/readiness
```

Do not print `.env`, Docker registry configuration, container environment, receipt content, or provider credentials into tickets, CI logs, or support output.
