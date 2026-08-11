# Single-pass PR CI and protected-main publication

## Request

Remove Basketra's duplicated full quality run on both pull requests and `main`. The supported repository model forbids direct pushes to `main`, so deterministic quality checks should run once on the pull request and the protected `main` push produced by merge should start publication directly.

## Evidence

- `.github/workflows/ci.yml` currently listens to both `pull_request` and `push` on `main`, so the same quality/security/browser/container gates execute before and after merge.
- `.github/workflows/publish-ghcr.yml` currently waits for the post-merge `Pull Request Quality` workflow through `workflow_run` and reads `workflow_run.head_sha`.
- Publication already performs its own immutable SHA checkout, multi-architecture build, exact manifest verification, exact-digest runtime smoke, semantic/stable promotion, GitHub Release creation, and bounded GHCR retention.
- The repository's intended trust boundary is protected `main`: direct pushes are not part of the supported release path.

## Decision

- Run `Pull Request Quality` only for pull requests targeting `main`.
- Keep the existing quality, security, browser E2E, platform container builds, container smoke, resource budgets, SBOM/provenance, vulnerability scanning and evidence behavior unchanged.
- Start `Publish verified private GHCR image and release` directly on `push` to `main`.
- Use `${{ github.sha }}` as the immutable publication SHA and keep the existing checkout verification.
- Remove the redundant `workflow_run` condition and event indirection.
- Preserve all existing release-version, exact-digest, promotion, GitHub Release, retention, and failed-candidate cleanup behavior.
- Treat branch protection that rejects direct `main` pushes and requires PR checks as an operational prerequisite.

## Acceptance

- [x] Pull Request Quality has no `push` trigger.
- [x] Pull Request Quality targets PRs to `main`.
- [x] GHCR publication triggers directly from `push` to `main`.
- [x] Publication uses `${{ github.sha }}` and no `workflow_run` payload.
- [x] Existing candidate verification, exact-digest smoke, semantic/stable promotion, release creation, and retention logic are unchanged.
- [x] Regression coverage locks the trigger/validated-SHA contract.
- [ ] Exact final PR head passes canonical CI before delivery.

## Checks

- `pnpm quality`
- security scan and production dependency audit
- Browser E2E
- amd64/arm64 container builds
- hardened container smoke
- exact-head Pull Request Quality workflow

## Risk

The publication workflow now deliberately trusts the protected `main` boundary instead of a second full CI execution. If repository settings later allow direct pushes to `main` or stop requiring the canonical PR checks, the publication trust model must be revisited before that policy change.

## Rollback

Restore the `push` trigger in `.github/workflows/ci.yml` and restore the publisher's `workflow_run` trigger/condition/`head_sha`. No application data, schema, image contents, or runtime configuration changes are involved.

## Delivery

- Branch: `agent/ci-single-pr-pass`
- Base: `main`
- Open one normal non-draft PR.
- Do not merge, release, publish, deploy, or change repository protection from this task.

## Status

Implementation is ready for exact-head CI validation.
