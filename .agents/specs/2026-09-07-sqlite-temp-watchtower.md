# SQLite temporary path and zero-touch Watchtower update

## Request

Receipt confirmation still fails after PR #54 was merged. Production diagnostics now report SQLite extended error code `6410` with `disk I/O error`. The Raspberry deployment is expected to update from `ghcr.io/juanjogondev/basketra:stable` through the scoped Watchtower without a manual rebuild or container recreation by the operator.

## Evidence

- `main` is `b4fc171580a5fbd3d862f7ff48d816597ca77659`, the squash merge of PR #54.
- The production Compose contract uses a read-only root filesystem and exposes one writable temporary mount at `/tmp/basketra`.
- The image did not define `SQLITE_TMPDIR` or `TMPDIR`, so SQLite's Unix temporary-directory search could skip the writable Basketra tmpfs and exhaust the read-only standard locations.
- SQLite extended code `6410` is `SQLITE_IOERR_GETTEMPPATH`, which is specifically the failure to resolve a usable temporary-file directory.
- The local Docker smoke used a writable `/tmp`, unlike production, so it could not reproduce this deployment class.
- Protected-main publication already builds a multi-architecture immutable candidate, smoke-tests it, and promotes the same digest to `stable`; Watchtower watches that stable image.

## Decision

Route both SQLite-specific and general process temporary files to the existing writable `/tmp/basketra` mount from inside the image by defining `SQLITE_TMPDIR` and `TMPDIR` in the runtime stage.

Do not change the Raspberry Compose contract for this fix. Watchtower re-creates containers from new images but does not re-read repository Compose changes, so an image-owned runtime fix is the only zero-touch path for an already-running correctly scoped Watchtower.

Align the local Docker smoke with production and force SQLite `temp_store = FILE` to create and read a TEMP table. Add the same probe to the immutable GHCR candidate before `stable` promotion so a broken image cannot reach Watchtower.

## Scope

Included:

- runtime image temporary-directory environment;
- Docker smoke parity with the production tmpfs;
- protected-main publication probe before stable promotion;
- regression contracts and deployment documentation.

Excluded:

- schema or data mutation;
- rewriting applied migrations;
- changing the persistent `basketra-data` volume;
- installing a new updater or changing host Docker configuration;
- merging, deploying, or mutating the Raspberry remotely.

## Risks

- A temporary-directory fix does not repair unrelated host storage corruption or a failing Docker volume. The extended error specifically points to temp-path resolution, so no destructive database action is justified.
- Watchtower can apply image changes without operator action only while the existing scoped Watchtower is running and authenticated to GHCR.
- Future changes to `compose.raspberry.yml` are host deployment-contract changes and are not fetched by Watchtower; this task avoids such a change.

## Acceptance

1. The production image exports `SQLITE_TMPDIR=/tmp/basketra`.
2. The production image exports `TMPDIR=/tmp/basketra`.
3. The local Docker smoke mounts only the same writable Basketra temp path used by production and proves a file-backed SQLite TEMP table works.
4. The protected-main publisher runs the same SQLite temporary-file behavior under the hardened exact-digest container before `stable` promotion.
5. The publication classifier still treats `Dockerfile` as GHCR-impacting, so merging this fix automatically builds and publishes a new stable candidate.
6. No manual Raspberry rebuild is required when the scoped Watchtower is already enabled.
7. Existing persistent data and migrations are untouched.
8. Required CI is green on the exact PR head before delivery.

## Checks

- `pnpm quality`
- repository security gate
- container smoke
- linux/amd64 and linux/arm64 image builds
- CodeQL
- exact-head GitHub Actions review
- published-image workflow contract unit coverage

## Rollback

Revert this commit or pin the prior immutable Basketra image/version using the documented rollback procedure. No database rollback is required because this change modifies no schema or persistent data.

## Delivery

Branch: `agent/fix-sqlite-temp-watchtower`.

Target: `main`.

No merge, release, deployment, or remote data mutation is authorized by this task.

## Status

Implementation prepared for CI validation.
