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

The Browser suite passed 142 tests in 15.1 minutes. One current visual-regression test loops all five viewports and seven routes in one Playwright test and alone takes about 1.2 minutes. Other individual Browser tests reach roughly 52 s and 36 s.

The existing local `pnpm quality` remains canonical and currently runs format, lint, typecheck, dead-code, dependency checks, unit tests, integration tests, static E2E, coverage gates and build sequentially.

## Decision

1. Keep `pnpm quality` unchanged as the canonical local aggregate command.
2. In pull-request CI, execute the same constituent gates as independent jobs so the serial aggregate no longer defines the CI critical path.
3. Shard Browser E2E deterministically with Playwright's native shard contract. Use one worker per shard so each shard has an isolated application process and no new shared-database races.
4. Enable Playwright full-parallel test partitioning so sharding can divide tests inside large spec files while preserving one worker inside each shard.
5. Refactor only Browser tests whose single-test runtime can exceed the one-minute budget, splitting existing assertions by viewport or responsibility without deleting coverage.
6. Browser shard jobs collect coverage instead of individually enforcing changed-code coverage. A dedicated aggregation job downloads every shard coverage artifact and applies the existing canonical `scripts/check-browser-diff-coverage.mjs` once across the merged evidence.
7. Keep Browser screenshots, videos and traces. Upload shard evidence under unique artifact names so visual publication can reconstruct the complete suite.
8. Remove the cross-workflow polling delay from visual evidence. Trusted publication will start from the completed authoritative Quality workflow, validate the exact PR/head, and process evidence in bounded stages rather than spending most of its runtime waiting.
9. Preserve the same-repository/trusted-author gate and fail closed before any privileged publication.
10. Bound CI jobs with a one-minute timeout where the workload is under repository control. Do not weaken mandatory gates if external GitHub service overhead makes a fixed platform action occasionally exceed that wall-clock; instead record that as a platform-bound exception with evidence.
11. Reduce CodeQL JavaScript/TypeScript scope only to production and executable repository code that is security relevant; do not drop JavaScript/TypeScript analysis from pull requests.

## Scope

Included:

- `.github/workflows/ci.yml`
- `.github/workflows/pr-visual-evidence.yml`
- `.github/workflows/codeql.yml` when a safe scope reduction is supported
- Browser coverage/reporting glue needed for sharding
- Browser test decomposition required to keep individual test bodies below the budget
- Workflow regression tests
- This specification

Excluded:

- Product behavior
- Runtime API contracts
- Database schema or migrations
- Release/deploy behavior
- Removal of required tests, coverage, security scanning, container validation or visual evidence

## Risks

- Excessive shard count can reduce per-check latency while increasing queue pressure and UI noise. Prefer the smallest count that satisfies the measured one-minute budget.
- Playwright sharding can expose tests that accidentally rely on suite order. Full-parallel partitioning is acceptable only with one worker per isolated shard and must be validated in CI.
- Browser changed-code coverage must be aggregated across shards; enforcing it per shard would create false failures.
- A `workflow_run` visual publisher has elevated trust and must never execute PR code. It must use workflow code from the protected default branch, validate the exact successful CI head and treat downloaded artifacts as untrusted input.
- CodeQL action startup and hosted-runner overhead are partly outside repository control. Any optimization must preserve the PR CodeQL gate.

## Acceptance criteria

1. Branch starts from the current `main` head.
2. No existing mandatory test, coverage, security, container or visual-evidence requirement is removed.
3. `pnpm quality` remains available and semantically unchanged for local/pre-push validation.
4. Pull-request quality work is decomposed into parallel jobs instead of one serial 81-second gate.
5. Browser E2E uses deterministic matrix sharding and all 142 baseline scenarios remain represented.
6. Browser changed-code coverage is checked once from the union of all shard coverage.
7. Long multi-viewport Browser scenarios are decomposed without deleting assertions or supported viewports.
8. Visual publication no longer waits inside a PR job for the Browser workflow to finish.
9. Privileged visual publication validates successful authoritative CI, same repository, trusted PR author association and exact current head before writes.
10. CI regression tests validate the sharding, coverage aggregation and visual-publication trust contract.
11. Every repository-controlled PR job is targeted to complete within 60 seconds on a warm normal GitHub-hosted run; CI evidence records actual durations.
12. CodeQL PR analysis remains enabled.
13. Final PR is non-draft, CI is green and no merge/release/deploy is performed.

## Checks

- `pnpm quality`
- `pnpm resource:measure`
- workflow/unit regression tests
- Browser shard matrix
- Browser aggregated changed-code coverage
- Security
- Container smoke
- linux/amd64 image build
- linux/arm64 image build
- CodeQL Actions
- CodeQL JavaScript/TypeScript
- visual-evidence workflow policy tests
- actual GitHub Actions job-duration review

## Rollback

Revert the CI optimization commits. No product data, schema or runtime contract changes are involved.

## Delivery

- Branch: `agent/perf-ci-under-one-minute`
- Pull request to `main`
- No merge, release or deploy without explicit approval.

## Status

In progress.
