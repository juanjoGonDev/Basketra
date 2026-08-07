# Trusted GHCR publication workflow

## Request

Repair the failed post-merge publication for Basketra and move image/release publication out of `.github/workflows/ci.yml` into a dedicated workflow. Work from a new branch and PR. Do not merge, deploy, modify Raspberry, rotate secrets, or publish an image from the PR.

## Evidence

- PR #14 merged to `main` as commit `63a272f0846c45a08d66310571c74a91d72379ec`.
- `.github/workflows/ci.yml` previously ran on pull requests and pushes to `main` while containing both validation jobs and the privileged GHCR publication job.
- `publish-image` depended on Browser E2E, so any browser validation failure skipped publication.
- Browser changed-code coverage resolves the base SHA through `resolveCoverageBaseSha()`.
- For a push checkout of `main`, `git merge-base main HEAD` resolves to `HEAD`; the browser reporter then receives an empty diff and fails with `No executable changed lines were found in the coverage report` even after all browser flows pass.
- Push events provide the authoritative previous commit in `github.event.before`.
- A workflow-only PR does not modify the tracked browser production modules and must not fail by pretending that an empty browser scope is uncovered code.

## Decision

1. Keep `.github/workflows/ci.yml` as the canonical validation workflow for pull requests and pushes to `main`.
2. Remove all write permissions and publication steps from `ci.yml`.
3. Add `.github/workflows/publish-ghcr.yml`, triggered only when the canonical CI workflow completes successfully.
4. Gate the privileged publication job on all of the following immutable workflow-run properties:
   - source workflow conclusion is `success`;
   - source event is `push`;
   - source branch is `main`;
   - source repository is the current repository.
5. Checkout and publish `github.event.workflow_run.head_sha`, never the publisher workflow's own `github.sha`.
6. Verify the checkout commit before building.
7. Preserve the existing verified publication sequence:
   - resolve deterministic patch version;
   - publish immutable SHA candidate;
   - verify manifest and digest;
   - pull and smoke-test the exact digest under production limits;
   - promote the same digest to `stable` and immutable version;
   - verify both promotions;
   - create or verify the GitHub release;
   - enforce bounded SHA-tag retention;
   - delete an unpromoted failed candidate.
8. Resolve differential coverage from the pull-request base SHA or push `before` SHA before falling back to Git history.
9. Skip browser differential coverage only when none of its explicitly tracked production modules changed; retain the 100% line/function/branch requirement whenever one did change.
10. Keep all action references pinned to immutable full SHAs and keep `permissions: read-all` as the workflow default.

## Acceptance criteria

- [x] `ci.yml` contains validation only and has no package/content write permission.
- [x] `publish-ghcr.yml` is a separately visible workflow definition.
- [x] PR events cannot execute the privileged publication job.
- [x] A failed or cancelled `main` CI cannot execute publication.
- [x] The trusted workflow is configured to publish only the exact validated head SHA after a successful same-repository `push` CI on `main`.
- [x] The publisher does not use `${{ github.sha }}` or `context.sha` as the release/image revision.
- [x] Browser and backend differential coverage compare a push against the event's previous commit.
- [x] Browser differential coverage succeeds without a false zero-coverage failure when no tracked browser production module changed.
- [x] Unit tests cover pull-request base selection, push-before selection, invalid/zero SHA rejection, precedence and empty/non-empty browser scope.
- [x] Security policy validates the separated trust boundary and publication order.
- [ ] Formatting, lint, strict types, unit, integration, E2E, browser, security, resource, container, AMD64, ARM64 and CodeQL checks pass on the exact final PR head.
- [x] No image, release, deployment or Raspberry mutation occurs from the PR.
- [ ] A post-merge successful `workflow_run` publishes, verifies and promotes the exact validated `main` SHA. This is external evidence unavailable before merge.

## Security

`workflow_run` has a privileged trust boundary. The publication job must not execute pull-request code or a foreign repository head. It may run only after successful CI for a same-repository push to `main`, and it must checkout the immutable validated SHA from the workflow-run payload. Job-scoped `contents: write` and `packages: write` are the only write permissions.

No PAT, package password, external credential or untrusted workflow input is introduced. GHCR authentication continues to use the job-scoped `GITHUB_TOKEN`.

The repository policy rejects write permissions in the validation workflow, pull-request publication, foreign repository heads, publisher-context SHAs, mutable action references, personal tokens and reordered candidate/promotion steps.

## Tests

- Unit tests cover event-to-base-SHA resolution, malformed and zero SHAs, source precedence, and browser coverage scope selection.
- Repository security policy consumes both workflow files and validates the separated trust boundary and publication sequence.
- The full quality gate and browser suite remain blocking on the PR.
- Docker smoke and both target architectures remain blocking in CI.
- The first successful post-merge `workflow_run` publication is the production publication evidence; it is not available before merge.

## Rollback

Revert this PR to restore the combined CI/publication workflow. No application schema, data or runtime contract changes are involved. If a candidate was published but not promoted, the existing cleanup step removes it. Existing immutable releases and `stable` remain untouched by repository rollback.

## Status

Repository implementation is complete on PR #16. Exact-head CI validation is pending. The workflow is intentionally unable to publish from this PR. Post-merge GHCR publication and release verification remain external evidence and must not be claimed before the trusted `main` workflow succeeds.
