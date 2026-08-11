# Local runtime parity

## Request

Make the full Basketra flow reproducible on a developer workstation after local `pnpm dev` failed during database migration with `no such module: fts5` under Node 22.13.0. Provide a one-command Docker development path that uses the production-equivalent Node/SQLite/Tesseract runtime and gives a clear failure before startup when the host Node build is unsupported. Since the developer already uses Volta, pin the canonical local Node runtime through repository metadata as the preferred native-development path.

## Evidence

- The repository declares Node `>=22.16.0 <23`, while the failing workstation is running Node 22.13.0.
- Product requirements and Docker runtime pin Node 22.23.1.
- Migration 1 creates `product_search` using SQLite FTS5, so FTS5 is a required runtime capability rather than an optional test feature.
- The production Docker image already runs Node 22.23.1 Alpine and validates the OCR runtime.
- Local Compose already builds that Dockerfile and exposes the same application service, but package scripts do not provide a direct development command.
- A containerized Basketra instance may need to reach a host-local webApi instance through `host.docker.internal` during the complete AI flow.
- The developer already has Volta available locally, so an exact project-level Node pin avoids relying on whichever global Node version happens to be first on PATH.

## Decision

- Keep `pnpm dev` as the native watch-mode path.
- Pin Node `22.23.1` in `package.json` through the `volta.node` project setting. Keep `engines.node` as the supported compatibility range and `packageManager` as the canonical pnpm pin; do not duplicate pnpm ownership in Volta.
- Add a `predev` runtime probe that fails early with an actionable message when the Node version is outside the supported range or the bundled SQLite build lacks FTS5.
- Add `pnpm dev:docker` as the runtime-parity path. It builds and recreates the local Compose service in the foreground so logs remain visible while testing.
- Add `pnpm dev:docker:down` for explicit cleanup while preserving the named data volume.
- Add the Docker host-gateway alias to local Compose so `BASKETRA_AI_BASE_URL=http://host.docker.internal:3001/v1/` works consistently on engines that support the standard `host-gateway` mapping.
- Do not replace FTS5, rewrite the migration, or weaken the runtime requirement to accommodate an unsupported Node build.

## Acceptance

- Entering the repository with Volta active selects Node 22.23.1 for native commands.
- Native `pnpm dev` fails before application startup with a clear remediation when Node is outside the supported range or FTS5 is unavailable.
- Supported Node builds pass the runtime probe without mutating persistent data.
- `pnpm dev:docker` builds and starts Basketra through `compose.yml` with the pinned Docker runtime.
- The Docker development service can address a host-local AI provider through `host.docker.internal`.
- No production deployment, schema, API, data, or secret behavior changes.

## Checks

- unit contract for the Volta Node pin, package scripts, and Docker host-gateway mapping
- runtime probe on the CI Node runtime
- `pnpm quality`
- container smoke and PR CI on the exact branch head

## Risk

The native runtime probe deliberately rejects unsupported local environments instead of allowing a later SQLite migration failure. The Volta pin is development-tooling metadata only and does not change the production runtime. The Docker host-gateway alias exposes only the host address from inside the container; it does not publish additional host ports or change Basketra's loopback bind.

## Rollback

Revert the development-tooling commits. Persistent data and schema require no rollback.

## Delivery

Branch: `agent/chore-docker-dev-runtime`.
Target: `main` via a normal non-draft pull request.
No merge, release, publication, deployment, or remote migration is authorized.

## Status

Implementation and deterministic regression coverage are complete, including the Volta Node pin. Canonical PR CI on the exact branch head remains the delivery gate.
