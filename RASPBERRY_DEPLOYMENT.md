# Private Raspberry Pi deployment

This runbook deploys Basketra from the private multi-architecture image `ghcr.io/juanjogondev/basketra`. The repository owner is written in lowercase because Docker image references require lowercase repository names.

Basketra remains private by default: the published port binds to loopback, persistent data stays in the named `basketra-data` volume, and the production Compose file requires an authentication token.

## Requirements

- Raspberry Pi OS or another Linux ARM64 distribution.
- Docker Engine with the Compose plugin.
- Access to the private GHCR package.
- OpenSSL for token generation.
- A private access path such as WireGuard, an SSH tunnel, or an authenticated private reverse proxy.
- Enough free disk space for the database, receipt evidence, migration backups, manual backups, and at least two container image revisions.

Do not expose Basketra directly on `0.0.0.0`. Keep `BASKETRA_BIND_ADDRESS=127.0.0.1` unless a reviewed LAN-only bind and matching firewall policy are intentionally configured.

## Authenticate to private GHCR

Use a classic GitHub personal access token with only `read:packages` for the deployment host. Do not place the token in `.env`, Compose, shell history, or this repository.

```bash
read -rsp 'GHCR read token: ' CR_PAT
echo
printf '%s' "$CR_PAT" | docker login ghcr.io -u juanjoGonDev --password-stdin
unset CR_PAT
```

Docker stores the registry authentication in its client configuration. Protect that directory with owner-only permissions. The optional scoped Watchtower service must receive the same Docker configuration directory through `BASKETRA_DOCKER_CONFIG_DIR`.

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

Review `.env` before deployment. Keep the defaults below unless there is an explicit operational reason to change them:

- `BASKETRA_IMAGE=ghcr.io/juanjogondev/basketra:stable`
- `BASKETRA_BIND_ADDRESS=127.0.0.1`
- `BASKETRA_PORT=3000`
- `BASKETRA_AI_IMAGE_CAPABILITY=true`
- `BASKETRA_AI_PDF_CAPABILITY=false`
- `WATCHTOWER_POLL_INTERVAL=300`
- `TZ=Europe/Madrid`

Provider credentials remain optional. Never add a real `.env` or registry token to Git.

## Verify the private image pull

```bash
docker compose -f compose.raspberry.yml config --quiet
docker compose -f compose.raspberry.yml pull basketra
docker image inspect ghcr.io/juanjogondev/basketra:stable \
  --format '{{index .RepoDigests 0}}'
docker compose -f compose.raspberry.yml images
```

A successful authenticated pull and a non-empty repository digest confirm that the host can retrieve the private image. In GitHub package settings, verify that the package visibility remains **Private** and that repository access is linked to `juanjoGonDev/Basketra`.

## Start Basketra

```bash
docker compose -f compose.raspberry.yml up -d basketra
docker compose -f compose.raspberry.yml ps
curl --fail --silent http://127.0.0.1:3000/health
curl --fail --silent http://127.0.0.1:3000/readiness
```

`/health` confirms that the HTTP process responds. `/readiness` confirms that startup initialization completed. The container healthcheck uses `/readiness`; migration or pre-migration backup failure prevents the service from becoming healthy.

Inspect startup without printing the environment:

```bash
docker compose -f compose.raspberry.yml logs --tail 100 basketra
docker inspect --format '{{json .State.Health}}' basketra-basketra-1
```

Do not use `docker inspect` formats that dump the full container environment.

## Automatic migrations

Basketra opens `/data/basketra.db` and applies pending migrations before the HTTP listener becomes ready. When migrations are pending it:

1. checkpoints SQLite WAL state;
2. creates a standalone pre-migration backup under `/data/backups/migrations`;
3. validates backup integrity and source schema version;
4. applies the complete pending migration batch in one transaction;
5. validates integrity and target version before commit.

A failed migration rolls back the complete pending batch and startup fails. Destructive migrations are rejected unless a future code change marks and explicitly authorizes them; no deployment environment variable can silently bypass that guard.

## Manual backup and validation

Use a unique file name and keep the token only in the shell environment:

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

The backup is stored in the persistent volume at `/data/backups/basketra-manual.db`. Copy important backups to separate storage according to the host backup policy; a named volume alone is not a disaster-recovery copy.

## Restore a validated backup

Restoration is deliberately offline. Validate first, stop Basketra, preserve the current database, replace it from the validated backup, and remove stale WAL sidecars:

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

If readiness fails, stop the service and repeat the offline copy using the generated `pre-restore-<timestamp>.db` file. Never copy over an active SQLite database.

## Roll back the application image

Every successful main-branch publication creates an immutable full commit-SHA tag in addition to `stable`. Set the previous known-good SHA tag in `.env`, pull it, and recreate Basketra:

```dotenv
BASKETRA_IMAGE=ghcr.io/juanjogondev/basketra:<previous-full-commit-sha>
```

```bash
docker compose -f compose.raspberry.yml pull basketra
docker compose -f compose.raspberry.yml up -d --no-deps basketra
curl --fail --silent http://127.0.0.1:3000/readiness
```

An immutable SHA tag does not move, so Watchtower cannot advance that tag. Restore `BASKETRA_IMAGE=ghcr.io/juanjogondev/basketra:stable` only after the stable release is known good.

## Scoped Watchtower every five minutes

`compose.raspberry.yml` includes an optional `autoupdate` profile using Watchtower `1.7.1`, `WATCHTOWER_SCOPE=basketra`, enable-label filtering, cleanup, and a 300-second poll interval. Basketra carries both required labels:

- `com.centurylinklabs.watchtower.enable=true`
- `com.centurylinklabs.watchtower.scope=basketra`

Before starting it, inspect every Watchtower instance already attached to the same Docker daemon:

```bash
docker ps --filter name=watchtower --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect --format '{{json .Config.Cmd}} {{json .Config.Env}} {{json .Config.Labels}}' watchtower
```

An unscoped Watchtower can still select scoped containers and can conflict with another instance. The current `raspberry5` convention includes a global Watchtower, so **do not start the Basketra instance until the global configuration has been reviewed and made compatible without affecting other containers**. This repository does not alter the global instance or the Raspberry host.

After that separate operational review, start only the scoped profile:

```bash
docker compose -f compose.raspberry.yml --profile autoupdate up -d watchtower
docker compose -f compose.raspberry.yml logs --tail 100 watchtower
```

Never configure both `WATCHTOWER_SCHEDULE` and `WATCHTOWER_POLL_INTERVAL`; Watchtower treats schedule and polling interval as mutually exclusive. This Compose file defines only `WATCHTOWER_POLL_INTERVAL=300`.

Watchtower upstream is archived and its latest release is pinned. Continue using it here only because the existing Raspberry stack already standardizes on it; review a maintained replacement before expanding its responsibility.

## Routine update and diagnostics

```bash
docker compose -f compose.raspberry.yml pull basketra
docker compose -f compose.raspberry.yml up -d basketra
docker compose -f compose.raspberry.yml ps
docker compose -f compose.raspberry.yml logs --tail 100 basketra
curl --fail --silent http://127.0.0.1:3000/readiness
```

Do not print `.env`, Docker registry configuration, container environment, receipt content, or provider credentials into tickets, CI logs, or support output.
