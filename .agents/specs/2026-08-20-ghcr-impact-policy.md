# GHCR publication impact policy

## Request

Publish a new Basketra GHCR image/release only when the protected `main` push can change the produced container image or the substantive GHCR publication behavior. Routine GitHub Actions dependency bumps must not publish a new image merely because they touch workflow files.

## Evidence

- `.github/workflows/publish-ghcr.yml` currently runs on every push to `main` and immediately resolves a release, logs in to GHCR, builds/pushes multi-arch, smoke-tests, promotes tags and creates/verifies a GitHub release.
- Merging PR #33, which contained only visual-evidence CI/spec/test/helper changes, therefore generated GHCR even though the application/container artifact was unchanged.
- `Dockerfile` builds the production artifact from `package.json`, `tsconfig.json`, `tsconfig.build.json`, `scripts/build.mjs` and `src/**`, then copies only `dist` into the runtime stage.
- `.dockerignore` can change which Docker build-context files are available and is therefore container-impacting.
- `publish-ghcr.yml` also executes `scripts/release-version-policy.mjs`, `scripts/ghcr-manifest-policy.mjs` and `scripts/ghcr-retention-policy.mjs`; substantive changes to those files affect publication behavior.
- Dependabot is configured for the `github-actions` ecosystem. Real PR #22 changed `.github/workflows/publish-ghcr.yml` only by replacing a pinned `uses:` action SHA/version; that mechanical update should not by itself publish GHCR.
- Docker dependency updates modify `Dockerfile` and therefore change the actual runtime/build image; those remain publication-impacting.

## Decision

Use `scripts/ghcr-publication-policy.mjs` as the single source of truth for GHCR publication impact.

Publication is required when the `main` push changes any of:

- `src/**`
- `Dockerfile`
- `.dockerignore`
- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`
- `scripts/build.mjs`
- `scripts/release-version-policy.mjs`
- `scripts/ghcr-manifest-policy.mjs`
- `scripts/ghcr-retention-policy.mjs`

A substantive change to `.github/workflows/publish-ghcr.yml` also requires publication. A change to that workflow is considered a mechanical GitHub Actions update, and therefore ignored for GHCR publication, only when every changed content line in that workflow is a `uses:` line. The decision is based on the actual diff, not PR author, labels, title or commit message.

Other workflow/config/test/spec/docs/Compose/repository-maintenance changes do not require GHCR by themselves.

Mixed changes are conservative: if any container/publication-impacting change exists, publication runs even when action-update or maintenance changes are present.

## Plan

1. Add pure, dependency-free policy tests covering RUN/SKIP and mixed sets, including a real-shaped action-pin diff versus a substantive publication-workflow diff.
2. Add the policy helper.
3. Split `publish-ghcr.yml` into a read-only classification job and the existing write-capable publication job.
4. Checkout the exact protected `main` SHA with enough history to compare `github.event.before` to `github.sha`.
5. Classify before release resolution, GHCR login, QEMU/Buildx or any publication work.
6. Keep the existing immutable-SHA build, digest verification, smoke test, stable/version promotion, release creation and retention unchanged for RUN.
7. Complete SKIP as a successful deliberate no-op with a clear log and no package/release mutation.

## Acceptance

RUN:

- any `src/**` change;
- `Dockerfile`, including a Docker base-image update;
- `.dockerignore`;
- `package.json`;
- either build TypeScript config;
- `scripts/build.mjs`;
- GHCR release/manifest/retention policy scripts;
- substantive `.github/workflows/publish-ghcr.yml` changes;
- any mixed set containing at least one RUN path.

SKIP:

- visual-evidence workflow/spec/test/helper changes such as PR #33;
- GitHub Actions dependency bumps that only replace `uses:` lines, including when `publish-ghcr.yml` is one of several bumped workflow files;
- other `.github/**` changes;
- tests/specs/docs/Markdown only;
- Compose-only changes;
- repository-maintenance-only changes;
- `pnpm-lock.yaml` / `pnpm-workspace.yaml` alone, because the current production Docker build neither copies nor installs them.

Operational:

- classification happens before release resolution or any GHCR write;
- SKIP does not log in to GHCR, configure QEMU/Buildx, build/push, promote, create a release or run retention;
- RUN preserves current publication/security behavior;
- the policy never relies on Dependabot identity, commit text, PR labels or workflow execution as impact signals;
- canonical quality/security checks pass;
- no merge/release/deploy is performed by this task.

## Tests

- unit table for artifact-impacting paths and non-impacting paths;
- action-only `uses:` SHA/version replacement -> SKIP;
- substantive `publish-ghcr.yml` edit -> RUN;
- action-only workflow update + runtime source -> RUN;
- action-only update across multiple workflows -> SKIP;
- workflow contract test proving classifier precedes and gates the privileged publisher;
- workflow contract test preserving direct protected-main push and immutable `github.sha` semantics.

## Checks

Implementation head `4b9646952edb87f94fba46e3b52b85517500f5b3` passed:

- Pull Request Quality run `32359313964`: success;
- Quality, Security, Container smoke, linux/amd64 and linux/arm64: success;
- Browser E2E: success;
- CodeQL Advanced run `32359313980`: success;
- Publish PR visual evidence run `32359314041`: success with the visual publisher skipped as expected because this PR has no visual/dependency trigger.

The final documentation-only head must repeat the canonical exact-head checks before delivery.

## Risks

- A path allowlist can become stale when Docker build inputs change. Contract tests must tie the policy to the explicit current Docker build inputs and publication-owned scripts.
- Misclassifying arbitrary workflow edits as dependency updates could suppress validation of publication behavior. Only changed content lines that are `uses:` declarations are eligible for the mechanical-update exception.
- `github.event.before` can be the all-zero SHA on branch creation. The policy fails safe to RUN rather than silently skipping an unclassifiable push.

## Rollback

Revert the classifier, helper/tests, workflow gate and this spec. No application state, schema, API or deployment migration is involved.

## Delivery

Branch: `agent/ci-ghcr-impact-gate`.

PR #34 targets `main` and remains non-draft. Do not merge.

## Status

Implementation and regression coverage are complete. First exact-head CI passed. Final documentation-only exact-head CI is pending before delivery.
