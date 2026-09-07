# SQLite temporary path and zero-touch Watchtower update

## Request

Receipt confirmation still fails after PR #54 was merged. Production diagnostics now report SQLite extended error code `6410` with `disk I/O error`. The Raspberry deployment is expected to update from `ghcr.io/juanjogondev/basketra:stable` through the scoped Watchtower without a manual rebuild or container recreation by the operator.

## Evidence

- `main` is `b4fc171580a5fbd3d862f7ff48d816597ca77659`, the squash merge of PR #54.
- The production Compose contract uses a read-only root filesystem and exposes one writable temporary mount at `/tmp/basketra`.
- The image did not define `SQLITE_TMPDIR` or `TMPDIR`, so SQLite's Unix temporary-directory search could skip the writable Basketra tmpfs and exhaust the read-only standard locations.
- SQLite extended code `6410` is `SQLITE_IOERR_GETTEMPPATH`, which is specifically the failure to resolve a usable temporary-file directory.
- The local Docker smoke used a writable `/tmp`, unlike production, so it could not reproduce this deployment class.
- Exact-head PR run `34100435315` later proved the new file-backed probe reproduces the same `ERR_SQLITE_ERROR` / extended code `6410` when the CI tmpfs omits the production ownership/mode options. The production Compose already owns `/tmp/basketra` as `uid=1000,gid=1000,mode=0700`; CI/local/publisher smokes must preserve those options instead of testing a different mount contract.
- Protected-main publication already builds a multi-architecture immutable candidate, smoke-tests it, and promotes the same digest to `stable`; Watchtower watches that stable image.

## Decision

Route both SQLite-specific and general process temporary files to the existing writable `/tmp/basketra` mount from inside the image by defining `SQLITE_TMPDIR` and `TMPDIR` in the runtime stage.

Do not change the Raspberry Compose contract for this fix. Watchtower re-creates containers from new images but does not re-read repository Compose changes, so an image-owned runtime fix is the only zero-touch path for an already-running correctly scoped Watchtower.

Own the SQLite temporary-file regression in one canonical `scripts/sqlite-temp-probe.mjs`. The local Docker smoke, PR container smoke and immutable GHCR candidate all execute that same probe under the hardened runtime with the same `mode=0700,uid=1000,gid=1000` tmpfs ownership as production before delivery or `stable` promotion. The probe forces file-backed TEMP storage with a tiny temp cache and a 2 MiB value so it cannot pass only because a trivial temporary table stayed in memory.

## Scope

Included:

- runtime image temporary-directory environment;
- one canonical SQLite temporary-file probe shared by local Docker smoke, PR container smoke and protected-main publication;
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
3. `scripts/sqlite-temp-probe.mjs` is the single owner of the file-backed SQLite TEMP regression.
4. The local Docker smoke and PR container smoke execute that canonical probe using only the same writable Basketra temp path used by production.
5. The protected-main publisher executes the same canonical probe under the hardened exact-digest container before `stable` promotion.
6. The publication classifier treats both `Dockerfile` and the canonical probe as GHCR-impacting, so changing either automatically rebuilds and republishes the image.
7. No manual Raspberry rebuild is required when the scoped Watchtower is already enabled.
8. Existing persistent data and migrations are untouched.
9. Required CI is green on the exact PR head before delivery.

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

Canonical probe consolidated during final review. PR run `34100435315` reproduced `6410` in the intentionally strengthened probe and exposed missing production tmpfs ownership parity in CI/local/publisher runners; parity fix prepared and exact-head revalidation pending.
