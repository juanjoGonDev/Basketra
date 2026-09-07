# CI under-one-minute optimization

## Request

Create a new branch from `main` and optimize Basketra pull-request CI so no individual CI check is allowed to run longer than one minute. Preserve the existing quality, coverage, Browser E2E, security, container and visual-evidence contracts instead of weakening or skipping them merely to obtain a faster green result.

## Evidence

Baseline measured from PR #53 on validated head `a0dd1c3a31406a6d6e6bcfd2b693ffbfebd5e8ff`:

- Pull Request Quality run `34054054636`
  - Quality: 101 s; the serial `pnpm quality` step consumed 81 s.
  - Security: 15 s.
  - Container linux/amd64: 26 s.
  - Container linux/arm64: 46 s.
  - Container smoke: 43 s.
  - Browser E2E: 1002 s; 910 s were Browser tests and 46 s artifact upload.
- Publish PR visual evidence run `34054054652`
  - Classifier: 8 s.
  - Publisher: 1063 s, including 998 s waiting for the separate Browser run.
- CodeQL run `34054054663`
  - Actions: 35 s.
  - JavaScript/TypeScript: 72 s.

The baseline Browser suite passed 142 tests in 15.1 minutes. A multi-viewport visual regression test alone exceeded one minute and several other Browser scenarios were large enough that equal-count sharding still produced slow checks.

## Decision

1. Keep `pnpm quality` unchanged as the canonical local aggregate command.
2. Execute its constituent pull-request gates as independent jobs so the serial aggregate no longer defines the CI critical path.
3. Split integration tests into two deterministic Node test shards with one-minute job envelopes.
4. Configure Browser CI with one number, `BASKETRA_BROWSER_SHARD_COUNT=56`. A deterministic planner parses Playwright's exact test list, applies measured timing hints plus an 8 s default for unknown tests, and greedily assigns tests to the least-loaded group.
5. Run each Browser group through Playwright `--test-list`, one worker per group, with a 45 s repository-work watchdog and a one-minute GitHub job timeout.
6. Keep the Browser application build and exact Chromium cache shared: build the application once, reuse the browser cache across commits of the same repository PR, and distribute only the prebuilt runtime plus group plan.
7. Split large Browser scenarios only where a single test itself threatened the budget; preserve their assertions, supported viewports and evidence.
8. Collect Browser changed-code coverage per group, upload it separately from screenshots/videos, download all lightweight coverage artifacts in parallel, and enforce the canonical differential coverage gate once on the merged evidence.
9. Keep Browser evidence separate from coverage so the coverage aggregation path never downloads video or screenshot payloads.
10. Replace emulated ARM64 builds with GitHub's native `ubuntu-24.04-arm` runner while retaining the amd64 build, SBOM and provenance gates.
11. Keep CodeQL Actions and JavaScript/TypeScript enabled, partition JavaScript/TypeScript by explicit architecture scopes that together cover the existing production/automation surface, and enforce the same one-minute timeout.
12. Remove the visual-evidence polling loop. Trusted publication starts from successful `Pull Request Quality` via `workflow_run`, validates the exact same-repository PR/head and trusted author association, downloads Browser evidence artifacts in parallel, prepares media in a read-only job, and reserves write permissions for the final publisher.
13. Preserve the real swipe behavior exposed by the new scheduling. The Browser run reproduced a pre-existing completion race where `pointerup.clientX` could contradict an already-crossed threshold; the smallest fix makes the last tracked horizontal displacement canonical and adds a regression.

## Scope

Included:

- `.github/workflows/ci.yml`
- `.github/workflows/pr-visual-evidence.yml`
- `.github/workflows/codeql.yml` and its CodeQL scope configuration
- Browser grouping, coverage/reporting and prebuilt-runtime glue
- Browser test decomposition needed to respect the check budget
- The narrowly scoped swipe regression fix required to preserve the existing Browser contract exposed by the new scheduling
- Workflow/planner regression tests
- This specification

Excluded:

- New product features or UX redesign
- API contract changes unrelated to the reproduced swipe regression
- Database schema or migrations
- Release/deploy behavior
- Removal of required tests, coverage, security scanning, container validation or visual evidence

## Risks

- Timing hints are intentionally non-authoritative optimization data. Unknown or renamed tests receive the conservative default and remain covered exactly once; CI failure, not the hint file, is authoritative.
- Excessive group count increases runner queue pressure. Fifty-six groups provide the validated timing margin: every Browser check in the final code run completed in 54 s or less while preserving one-worker isolation.
- Playwright test-list execution is CI orchestration only; Browser behavior remains owned by the canonical tests and one-worker process isolation.
- Browser changed-code coverage must be aggregated across all groups; enforcing it per group would produce false failures.
- A `workflow_run` publisher has elevated trust and must never execute PR code. It checks out policy code from the default branch, validates the successful source run and current PR head, and treats downloaded artifacts as untrusted input.
- GitHub-hosted runner provisioning is outside repository control, so the workflow also contains hard one-minute job timeouts rather than merely relying on observed warm-run timings.

## Acceptance criteria

1. The branch contains the latest `main` before final validation.
2. No mandatory test, coverage, security, container or visual-evidence requirement is removed.
3. `pnpm quality` remains available and semantically unchanged for local/pre-push validation.
4. Pull-request quality work is decomposed into parallel checks instead of one serial 81-second gate.
5. Browser E2E uses deterministic duration-aware grouping configured only by group count and represents all 154 tests in the validated suite exactly once.
6. Browser changed-code coverage is checked once from the union of all group coverage artifacts.
7. Long multi-viewport Browser scenarios are decomposed without deleting assertions or supported viewports.
8. Visual publication no longer waits inside a PR job for the Browser workflow to finish.
9. Privileged visual publication validates successful authoritative CI, same repository, trusted PR author association and exact current head before writes.
10. Workflow and planner regression tests validate grouping, coverage aggregation, one-minute limits and the visual-publication trust contract.
11. Every observed repository-controlled PR check on the validated code head completes within 60 seconds.
12. CodeQL PR analysis remains enabled for both Actions and JavaScript/TypeScript and completes within 60 seconds.
13. Final PR is non-draft, CI is green and no merge/release/deploy is performed.

## Checks

- `pnpm quality` contract preserved; constituent CI gates executed independently
- `pnpm resource:measure`
- unit/workflow/planner regressions
- 56-group Browser matrix covering 154 tests
- Browser aggregated changed-code coverage
- Security
- Container smoke
- linux/amd64 image build
- native linux/arm64 image build
- CodeQL Actions
- CodeQL JavaScript/TypeScript
- visual-evidence workflow policy tests
- GitHub Actions job-duration review

## Final validation evidence

Validated code head before this documentation-only update: `5a844ded7d984292e554ae72b529209622452ed7`.

- Pull Request Quality `34100458145`: success.
  - 72 jobs completed successfully.
  - 56 duration-aware Browser groups represented all 154 tests exactly once.
  - Slowest observed Browser check: 54 s; the next slowest was 53 s.
  - Browser runtime: 25 s.
  - Browser aggregate coverage: 12 s.
  - Integration shards: 26 s and 25 s.
  - Container smoke: 37 s.
  - linux/amd64 container: 29 s.
  - native linux/arm64 container: 29 s.
  - Unit: 22 s; Static quality: 16 s; Domain coverage: 16 s; Changed coverage: 13 s; Web coverage: 17 s; Build: 19 s; Resource budgets: 25 s; Security: 13 s.
- CodeQL `34100458042`: success.
  - Actions: 36 s.
  - JavaScript/TypeScript automation: 49 s.
  - JavaScript/TypeScript web: 53 s.
  - JavaScript/TypeScript backend catalog: 51 s.
  - JavaScript/TypeScript backend platform: 47 s.
  - JavaScript/TypeScript backend operations: 58 s.
  - JavaScript/TypeScript receipt runtime: 56 s.
  - JavaScript/TypeScript receipt AI/OCR: 51 s.
- Every Pull Request Quality job and every CodeQL architecture scope has a hard one-minute workflow timeout, with regression tests protecting those envelopes.
- The visual `workflow_run` definition cannot execute from a PR branch because GitHub resolves that trigger from the default branch. Its read/write trust boundary, artifact contract and no-polling behavior are therefore validated statically/unit-level in this PR; operational execution becomes available only after the workflow definition exists on `main`.
- A direct local `pnpm quality` run was not claimed because this connector environment does not provide a local repository checkout. Its constituent gates are represented by the successful CI jobs above.

## Rollback

Revert the CI optimization commits. No database migration, release or deployment is involved.

## Delivery

- Branch: `agent/perf-ci-under-one-minute`
- Pull request: #55 to `main`
- No merge, release or deploy without explicit approval.

## Status

Done. Final documentation-only head still requires the same GitHub Actions gates before handoff.
