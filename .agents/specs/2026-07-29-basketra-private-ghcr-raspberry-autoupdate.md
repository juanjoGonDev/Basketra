# Basketra private GHCR Raspberry auto-update

## Request

Prepare Basketra for private automatic Raspberry Pi deployment without modifying the Raspberry host or committing real credentials. Publish a private multi-architecture GHCR image only after complete CI success, provide a hardened Raspberry Compose variant with scoped Watchtower support, make startup migrations backup-first and transactional, document operations, and continue on pull request #1.

## Evidence

- Pull request #1 targets `main` from `agent/feat-basketra-foundation`; no additional branch or pull request is required.
- Existing CI already separates quality, security, browser, container smoke, AMD64, and ARM64 gates.
- The application constructs `BasketraDatabase` before listening and sets readiness only after the HTTP listener starts, so migration failure already prevents readiness when the container probes `/readiness`.
- Previous migrations ran one migration transaction at a time and did not create or validate a pre-migration backup.
- Local Compose was hardened and loopback-only but omitted the already supported image/PDF capability variables and probed `/health` rather than `/readiness`.
- The `raspberry5` repository requires explicit bind addresses and memory limits. It also has an existing global, label-enabled Watchtower, so a second instance must remain optional until scopes are reconciled operationally.
- Docker image repository references require lowercase; the valid target is `ghcr.io/juanjogondev/basketra` even though the GitHub account is displayed as `juanjoGonDev`.

## Decision

- Extend the existing CI workflow with one main-push-only publication job that depends on every existing gate and receives only `contents: read` and `packages: write`.
- Publish full commit SHA and `stable` tags for `linux/amd64` and `linux/arm64`, with SBOM and provenance.
- Keep `compose.yml` for local builds and add `compose.raspberry.yml` for the private GHCR image, named persistence, loopback bind, resource limits, readiness healthcheck, required authentication, and Watchtower labels.
- Include a pinned, optional `autoupdate` Watchtower profile scoped to Basketra and polling every 300 seconds. Do not start or alter any Raspberry service from this repository task.
- Apply the complete pending migration batch in one transaction. Before the transaction, checkpoint WAL, create a standalone SQLite backup, and validate integrity plus source schema version.
- Reject destructive migrations by default through a code-level migration classification. Do not expose an environment bypass.
- Keep manual restore offline and documented; HTTP validates backups but does not perform destructive replacement.

## Scope

- `.github/workflows/ci.yml`
- `compose.yml`, `compose.raspberry.yml`, `.env.example`, and `Dockerfile`
- `src/infrastructure/database.ts`
- representative version-one schema fixture and integration coverage
- repository security/policy scan
- `README.md`, `BACKUP_AND_RESTORE.md`, and `RASPBERRY_DEPLOYMENT.md`
- existing pull request #1 description and CI evidence

## Risks

- The GHCR package visibility must remain Private in package settings; the workflow cannot safely assume a previously changed package visibility.
- The existing unscoped global Watchtower can select scoped containers and conflict with another instance. The dedicated Basketra profile must not be started until the host-wide Watchtower design is reviewed separately.
- Watchtower upstream is archived. Version `1.7.1` is pinned because the existing Raspberry stack already uses Watchtower; replacement evaluation is future operational work.
- Automatic database migrations cannot make an application binary backward-compatible with every future schema. Image rollback after a forward migration may require restoring the generated pre-migration backup.
- CI can validate ARM64 builds but cannot prove resource behavior or registry authentication on the physical Raspberry host.

## Acceptance

- All pull-request CI gates pass.
- GHCR publication runs only on a validated push to `main` and publishes full-SHA plus `stable` multi-architecture tags.
- Only the publication job receives package write permission.
- Raspberry Compose resolves successfully, defaults to loopback, retains `/data`, requires authentication, carries the required Watchtower labels, and includes both AI capability variables.
- Container health uses `/readiness`; failed initialization cannot become healthy.
- A representative version-one fixture upgrades to the current schema without data loss and creates a validated version-one pre-migration backup.
- An injected failing migration rolls back the complete pending batch and preserves a valid source-version backup.
- Reopening an already current database is idempotent and creates no additional migration backup.
- Destructive migrations fail without explicit code-level authorization.
- Documentation covers private GHCR login, token generation, pull/start, health/readiness, backup, restore, SHA rollback, scoped five-minute Watchtower operation, and global-instance conflict warnings.
- Repository scans reject mutable action references, unsafe workflow permissions, real-looking credentials, unsafe login commands, incomplete Compose controls, and incomplete environment examples.

## Validation

Local executed validation before delivery:

- `tsc --noEmit`
- `node --experimental-strip-types --test tests/integration/database.test.ts`
- `node scripts/security-scan.mjs`
- syntax checks for changed TypeScript and JavaScript
- repository format policy checks over the changed files

Docker Compose, image build, Trivy, browser flows, complete quality, AMD64, ARM64, and publication gating are authoritative in GitHub Actions because the local execution environment does not provide a Docker daemon or Raspberry hardware.

## Rollback

- Revert the delivery commits on pull request #1 before merge, or revert them from `main` after merge.
- For application deployment rollback, set `BASKETRA_IMAGE` to the previous immutable full-SHA tag and recreate only Basketra.
- If a newer schema is incompatible with the previous image, stop Basketra and restore the validated pre-migration backup generated for that upgrade.
- Do not delete migration or manual backups until the restored version and critical data are verified.

## Delivery

Continue on `agent/feat-basketra-foundation` and update pull request #1. Do not create another pull request, merge, deploy, modify the Raspberry host, or change real secrets.

## Status

Implementation and local validation complete. Remote CI, PR evidence, and final status remain pending until the branch commits are pushed and all checks finish.
