# Docker provider probe fixture packaging

## Request

Fix the deployed Basketra Settings AI provider check returning `500 INTERNAL_ERROR` before the request reaches webApi after the repository PNG provider probe was released.

## Evidence

- Production logs for release `1.0.10` show `ai.capability_probe_failed` with `status: 500`, `code: INTERNAL_ERROR`, and the client call fails in a few milliseconds.
- `OpenAiCompatibleProvider.testConnection()` reads `./fixtures/provider-probe.png` synchronously before entering `executeStructured()`. A missing fixture therefore escapes as a raw filesystem error and is mapped by the gateway to `INTERNAL_ERROR` before any provider HTTP request is attempted.
- `scripts/build.mjs` is the canonical production-artifact builder and copies `src/ai/fixtures` to `dist/ai/fixtures`.
- `Dockerfile` currently reimplements the build sequence directly with `tsc`, copies only `src/web` and `package.json`, and therefore omits `dist/ai/fixtures` from the runtime image.

## Decision

- Make the Docker build stage invoke the existing canonical `scripts/build.mjs` instead of duplicating its artifact assembly commands.
- Copy only the build script required by the Docker build stage.
- Add a regression test that verifies Docker delegates artifact assembly to `scripts/build.mjs` and does not duplicate the old partial copy sequence.
- Preserve the provider wire contract, PNG bytes, strict structured output, retry policy, API behavior, database, secrets, and runtime topology.

## Acceptance

- The Docker runtime image contains `dist/ai/fixtures/provider-probe.png` because it consumes the same artifact builder as local production builds.
- The Dockerfile has one canonical artifact assembly path through `node scripts/build.mjs`.
- Regression coverage fails if Docker returns to the previous partial `tsc + src/web` assembly.
- Existing quality, security, integration, browser, container smoke, and multi-platform container jobs pass on the exact PR head.
- No release, deployment, merge, protected-branch change, or secret mutation is performed.

## Checks

- `pnpm quality`
- focused Docker artifact regression test
- canonical Pull Request Quality workflow, including container smoke and both container architectures

## Risk

The Docker build now depends explicitly on `scripts/build.mjs`, which is already the repository-owned production artifact source of truth. If that script changes, Docker and local production builds intentionally change together, preventing packaging drift.

## Rollback

Revert this PR. No data or schema rollback is required.

## Delivery

Branch: `agent/fix-docker-provider-probe-fixture`.
Target: `main` via a normal non-draft PR.

## Status

Recon and root-cause analysis complete; implementation and exact-head CI pending.
