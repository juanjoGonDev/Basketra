# Verified GHCR publication before stable promotion

## Status

Implemented and validated in pull-request CI. Live GHCR publication remains intentionally pending an approved merge to `main`.

## Request

Use the existing Basketra pull request and branch. Synchronize with `main`, keep all existing quality gates, publish only an immutable full-SHA candidate after a successful main workflow, verify the exact registry artifact, and promote `stable` only after manifest and runtime validation. Do not merge, deploy, modify the Raspberry host, or add real secrets.

## Evidence

- The branch is synchronized with current `main` (`behind_by: 0`) and the existing PR remains open and unmerged.
- The existing workflow already separated the initial SHA publication from `stable` promotion and captured the Buildx digest.
- The registry manifest check previously inspected a digest-qualified reference but did not independently compare the digest returned by the registry to the Buildx output.
- The published-image smoke test waited for readiness and invoked `docker stop`, but did not assert a clean container exit code.
- Stable verification compared raw manifest bytes. Digest equality is a clearer registry contract and is less sensitive to representation details.
- README and the Raspberry runbook described staged promotion but did not include every requested manual SHA/stable inspection and pull command.

## Decision

- Add a small dependency-free manifest-policy module with pure, unit-tested validation.
- Inspect the full-SHA tag through `docker buildx imagetools inspect --format '{{json .Manifest}}'` and require its registry digest to equal the digest emitted by `docker/build-push-action`.
- Require exactly the runnable platforms `linux/amd64` and `linux/arm64`, ignoring attestation descriptors with unknown platforms.
- Pull the full-SHA tag from GHCR, verify the revision label, and run the exact digest under the existing production limits.
- Validate shutdown duration and require container exit code zero before promotion.
- Promote the validated digest with `docker buildx imagetools create` and verify that `stable` resolves to that same digest.
- Keep minimum job permissions, pinned actions, existing CI dependencies, retention, and failed-candidate cleanup.
- Extend the security/policy scan so ordering and the stronger digest/shutdown contracts cannot regress.
- Document manual manifest inspection and pulls for both the immutable SHA and `stable` tags.

## Acceptance criteria

- Pull-request CI retains Quality, Security, Browser E2E, container smoke, AMD64, and ARM64 gates.
- `publish-image` remains main-push-only and skipped on pull requests.
- The initial Buildx publication contains only the full-SHA tag.
- Candidate manifest digest equals the Buildx output and contains AMD64 and ARM64 runnable entries.
- The candidate full-SHA tag is pulled from GHCR and the exact digest reaches `/readiness` under production limits.
- Graceful shutdown completes within 20 seconds and exits with code zero.
- `stable` is created from the validated digest without rebuilding and resolves to that digest.
- Workflow actions remain pinned and no PAT or real secret is introduced.
- README and Raspberry documentation contain executable manual verification commands.
- PR #1 remains open and unmerged.

## Validation plan

- Run the new manifest-policy unit tests.
- Run `pnpm quality` and the executable resource budget.
- Run the repository security/policy scan.
- Parse the workflow and Compose YAML.
- Let pull-request CI execute browser, Trivy, hardened container smoke, AMD64, and ARM64 builds.
- Confirm the publication job is skipped on the PR event.
- The live GHCR pull, smoke, promotion, and retention path can execute only after an approved merge to `main`; report this boundary explicitly.

## Validation evidence

Pull Request Quality run `30486194631` passed on implementation head `abc715affe9dc27a18262f552421a49759ea683a`:

- 33 unit tests, including three manifest-policy tests, passed with no skips;
- 9 SQLite/HTTP integration tests and 1 end-to-end acceptance test passed;
- deterministic domain coverage remained at 100% lines, functions, and branches;
- all 8 real mobile Chromium flows passed with evidence upload;
- security and workflow policy scanning passed;
- the hardened local container, Trivy scan, resource assertions, AMD64 build, and ARM64 build passed;
- the main-only publication job was skipped as designed on the pull-request event.

## Risks

- GHCR may expose a newly published tag with short eventual-consistency delay; bounded retries remain necessary.
- Package deletion requires repository administration access to the package. Retention failures must fail visibly rather than silently weakening cleanup.
- Successful CI cannot prove Raspberry-specific authentication, storage latency, thermal behavior, or Watchtower interaction without touching the target host.

## Rollback

Revert the verified-publication commit. Existing immutable SHA images and local application data remain unaffected. Never delete the `basketra-data` volume as part of an application rollback.

## Delivery

Use `agent/feat-basketra-foundation` and update pull request #1. Do not create another pull request and do not merge.
