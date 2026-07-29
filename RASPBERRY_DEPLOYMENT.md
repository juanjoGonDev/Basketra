# Private Raspberry Pi deployment

This runbook deploys Basketra from the private multi-architecture image `ghcr.io/juanjogondev/basketra`. Docker repository references are lowercase even though the account display name is `juanjoGonDev`.

Basketra remains private by default: the published port binds to loopback, persistent data stays in the named `basketra-data` volume, and the production Compose file requires an authentication token.

## Requirements

- Raspberry Pi OS or another Linux ARM64 distribution.
- Docker Engine with the Compose plugin.
- Access to the private GHCR package.
- OpenSSL for token generation.
- A private access path such as WireGuard, an SSH tunnel, or an authenticated private reverse proxy.
- Free disk capacity for the bounded application data plus at least two image revisions.

Do not expose Basketra directly on `0.0.0.0`. Keep `BASKETRA_BIND_ADDRESS=127.0.0.1` unless a reviewed LAN-only bind and firewall policy are intentionally configured.

## Authenticate to private GHCR

Use a classic GitHub personal access token with only `read:packages` on the deployment host. Do not place the token in `.env`, Compose, shell history, or this repository.

```bash
read -rsp 'GHCR read token: ' CR_PAT
echo
printf '%s' "$CR_PAT" | docker login ghcr.io -u juanjoGonDev --password-stdin
unset CR_PAT
```

Protect Docker's client configuration with owner-only permissions. The optional Watchtower service receives that same directory through `BASKETRA_DOCKER_CONFIG_DIR`.

## Create the deployment environment

```bash
cp .env.example .env
umask 077
token="$(openssl rand -hex 32)"
{
  while IFS= read -r line; do
    case "$line" in
      BASKETRA_AUTH_TOKEN=*) printf 'BASKETRA_AUTH_TOKEN=%s\n' "$token" ;;
      BASKETRA_DOCKER_CONFIG_DIR=*) printf 'BASKETRA_DOCKER_CONFIG_DIR=${HOME}/.docker\n' ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < .env.example
} > .env
unset token
chmod 600 .env
```

Keep these defaults unless measurements on the target justify a reviewed change:

- `BASKETRA_IMAGE=ghcr.io/juanjogondev/basketra:stable`
- `BASKETRA_BIND_ADDRESS=127.0.0.1`
- `BASKETRA_NODE_HEAP_MB=128`
- `BASKETRA_MEMORY_LIMIT=192m`
- `BASKETRA_CPU_LIMIT=0.75`
- `WATCHTOWER_POLL_INTERVAL=300`
- `WATCHTOWER_MEMORY_LIMIT=128m`
- `TZ=Europe/Madrid`

Compose sets memory+swap equal to the memory limit, caps PIDs and CPU, uses bounded tmpfs mounts, and rotates each service log at three 5 MiB files. Provider credentials remain optional. Never commit a real `.env` or registry token.

## Verify the private image pull

After an approved merge, inspect and pull the immutable candidate before relying on `stable`:

```bash
COMMIT_SHA=<full-commit-sha>
docker buildx imagetools inspect "ghcr.io/juanjogondev/basketra:${COMMIT_SHA}"
docker pull "ghcr.io/juanjogondev/basketra:${COMMIT_SHA}"
docker pull ghcr.io/juanjogondev/basketra:stable
```

Then validate the production Compose reference:

```bash
docker compose -f compose.raspberry.yml config --quiet
docker compose -f compose.raspberry.yml pull basketra
docker image inspect ghcr.io/juanjogondev/basketra:stable \
  --format '{{index .RepoDigests 0}}'
docker compose -f compose.raspberry.yml images
```

A successful authenticated pull and non-empty repository digest confirm access. In package settings, keep visibility **Private** and repository access linked to `juanjoGonDev/Basketra`.

## Start Basketra

```bash
docker compose -f compose.raspberry.yml up -d basketra
docker compose -f compose.raspberry.yml ps
curl --fail --silent http://127.0.0.1:3000/health
curl --fail --silent http://127.0.0.1:3000/readiness
```

`/health` confirms HTTP liveness. `/readiness` confirms database initialization and migrations completed. Migration, backup-retention, database-size, or existing-file-budget failure prevents the service from becoming healthy.

Inspect startup without printing the environment:

```bash
docker compose -f compose.raspberry.yml logs --tail 100 basketra
docker inspect --format '{{json .State.Health}}' basketra-basketra-1
docker stats --no-stream basketra-basketra-1
```

Do not use inspection formats that dump the full environment.

## Automatic migrations and storage retention

Before listening, Basketra checkpoints WAL, reserves room under both count and byte retention budgets, creates and validates an atomic standalone pre-migration backup, applies the complete batch transactionally, and validates the target database before commit.

Defaults:

- primary SQLite database: 512 MiB maximum;
- SQLite cache: 8 MiB;
- WAL target: 16 MiB;
- migration backups: newest 3, maximum 768 MiB combined;
- manual backups: newest 5, maximum 768 MiB combined;
- deduplicated receipt files: 512 MiB maximum.

Repeated failed migrations cannot create unlimited backups. Failed temporary copies are removed. A destructive migration requires explicit code-level authorization; no deployment environment variable bypasses that guard.

## Manual backup and validation

```bash
export BASKETRA_AUTH_TOKEN
curl --fail --request POST http://127.0.0.1:3000/api/v1/backup \
  --header "Authorization: Bearer $BASKETRA_AUTH_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-manual.db"}'

curl --fail --request POST http://127.0.0.1:3000/api/v1/restore/validate \
  --header "Authorization: Bearer $BASKETRA_AUTH_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-manual.db"}'
unset BASKETRA_AUTH_TOKEN
```

Copy important backups out of the named volume before retention removes older local copies.

## Restore a validated backup

Restoration is deliberately offline:

```bash
export BASKETRA_AUTH_TOKEN
curl --fail --request POST http://127.0.0.1:3000/api/v1/restore/validate \
  --header "Authorization: Bearer $BASKETRA_AUTH_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-manual.db"}'
unset BASKETRA_AUTH_TOKEN

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

If readiness fails, stop the service and restore the preserved database. Never copy over an active SQLite database. The emergency `pre-restore` copy is operational and not automatically managed by the API retention policy; move or remove it after recovery.

## Verified publication and image rollback

An approved merge does not immediately move `stable`. The main workflow:

1. publishes only a full-SHA multi-architecture candidate;
2. inspects the full-SHA tag in GHCR and requires its registry digest to match the Buildx output;
3. verifies AMD64 and ARM64 runnable manifest entries while ignoring attestation descriptors;
4. pulls the full-SHA tag from GHCR;
5. checks the revision label and starts the exact digest under production limits;
6. waits for `/readiness`, requires shutdown within 20 seconds, and requires exit code zero;
7. promotes that identical digest to `stable` without rebuilding;
8. verifies that `stable` resolves to the validated digest;
9. retains only the newest ten immutable SHA releases.

A candidate that fails before promotion is deleted. Set a previous retained SHA in `.env` for rollback:

```dotenv
BASKETRA_IMAGE=ghcr.io/juanjogondev/basketra:<previous-full-commit-sha>
```

```bash
docker compose -f compose.raspberry.yml pull basketra
docker compose -f compose.raspberry.yml up -d --no-deps basketra
curl --fail --silent http://127.0.0.1:3000/readiness
```

An immutable SHA tag does not move. Return to `stable` only after the release is known good. A schema-incompatible application rollback may also require restoring its pre-migration backup.

## Scoped Watchtower every five minutes

The optional `autoupdate` profile uses Watchtower `1.7.1`, `WATCHTOWER_SCOPE=basketra`, enable-label filtering, and a 300-second interval. It removes superseded local image data after a successful update but explicitly sets `WATCHTOWER_REMOVE_VOLUMES=false`; application data volumes must never be deleted by cleanup.

Before starting it, inspect every Watchtower attached to the daemon:

```bash
docker ps --filter name=watchtower --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect --format '{{json .Config.Cmd}} {{json .Config.Env}} {{json .Config.Labels}}' watchtower
```

An unscoped Watchtower can select scoped containers and conflict with another instance. The existing `raspberry5` convention includes a global Watchtower, so **do not start Basketra's instance until the global configuration has been reviewed and reconciled without affecting other containers**. This repository does not alter the global instance or the Raspberry host.

After that separate review:

```bash
docker compose -f compose.raspberry.yml --profile autoupdate up -d watchtower
docker compose -f compose.raspberry.yml logs --tail 100 watchtower
```

Never combine `WATCHTOWER_SCHEDULE` and `WATCHTOWER_POLL_INTERVAL`. Watchtower upstream is archived; `1.7.1` remains pinned only because the existing host standardizes on it. Evaluate a maintained replacement before expanding its responsibility.

## Routine diagnostics

```bash
docker compose -f compose.raspberry.yml pull basketra
docker compose -f compose.raspberry.yml up -d basketra
docker compose -f compose.raspberry.yml ps
docker compose -f compose.raspberry.yml logs --tail 100 basketra
curl --fail --silent http://127.0.0.1:3000/readiness
```

Do not print `.env`, Docker registry configuration, container environment, receipt content, or provider credentials into tickets, CI logs, or support output.
