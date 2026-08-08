# Actions runtime hardening

## Request

Investigate and correct the shared required-QA Dependabot merge automation after real runtime failures without widening workflow permissions.

## Evidence

- Run `31249100733`, job `93082477475`, failed while refreshing Dependabot PR #6 because the PR changes `.github/workflows/ci.yml`; GitHub rejected the update with `403` because the token has no Workflows permission.
- The same shared workflow can call `enablePullRequestAutoMerge` after a valid approval when GitHub already reports the PR as `clean`; GitHub rejects that mutation because the PR is immediately mergeable.
- An immediate merge using `GITHUB_TOKEN` would suppress most downstream workflow events, so it is not an acceptable fallback.

## Decision

- Preserve exact-head, non-bot, write-maintainer approval and revalidate it immediately before any merge transition.
- Use the protected `admin` Actions secret `PAT_FINE`, validated as the repository owner, for live branch/merge transitions so downstream GitHub Actions events remain eligible to run.
- Do not grant Workflows permission. If a behind PR changes `.github/workflows/*`, report `manual-branch-update-required`; the trusted manual update must be followed by a fresh approval for the new head.
- For non-workflow behind PRs, request the branch update and require fresh approval.
- If GitHub reports `clean`, squash-merge only the validated head SHA. Otherwise enable repository auto-merge when available; revalidate again if the PR becomes clean during that call.
- Keep dry-run non-mutating.

## Acceptance

- The observed workflow-file update 403 becomes an explicit non-failing manual-update state rather than a request for broader permission.
- Clean approved majors do not fail the auto-merge mutation.
- Stale/bot approvals, change requests, changed heads, conflicts and unknown merge states cannot merge.
- Downstream workflows are not intentionally suppressed by `GITHUB_TOKEN` merge mutations.

## Checks

Parse workflow YAML, syntax-check shell and `github-script` code, verify immutable Action SHAs, and use pull-request CI as the final authority.

## Rollback

Revert the corrective pull request. No merge, release, publish or deployment is performed by this branch.

## Delivery status

Implemented on `agent/fix-actions-runtime-20260808`; pending pull-request CI and explicit owner merge approval.
