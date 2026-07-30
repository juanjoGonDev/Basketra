# Private mobile workflows

The authoritative task trace is [2026-07-30-private-mobile-workflows.md](2026-07-30-private-mobile-workflows.md). This dated routing file records that implementation continued across midnight in the Europe/Madrid timezone without changing the original task scope, branch, or acceptance criteria.

- Request date: 2026-07-30.
- Delivery date: 2026-07-31.
- Branch: `agent/fix-private-mobile-workflows`.
- Merge, release, deployment, and Raspberry host changes remain excluded.

## Follow-up: mandatory pull-request evidence

### Request

Make browser evidence directly discoverable from the pull request and prevent future PRs from omitting accessible evidence links or inline visual proof.

### Evidence

- PR #7 described the artifact by ID and digest but did not initially provide a clickable artifact link.
- The complete Playwright artifact is approximately 74 MB and contains screenshots, videos, traces, and the HTML report.
- Committing the complete artifact would create unnecessary repository growth; GitHub Actions already provides the authoritative downloadable archive.

### Decision

- Add a recognized `.github/pull_request_template.md`.
- Make the evidence section mandatory for every PR.
- Require clickable links to the successful workflow run and complete artifact generated from the final head SHA.
- Require representative screenshots or GIFs directly in the PR body for user-visible changes.
- Require downloadable video/trace evidence for critical flows.
- Reject local paths, temporary signed URLs, plain IDs without links, and evidence from stale commits.
- Permit `Not applicable` only when the PR has no user-visible behavior and includes a reason.

### Acceptance

- PR #7 contains direct clickable links to the final workflow run and browser artifact.
- Future PRs are pre-populated with the mandatory evidence contract.
- The template checklist requires inline visual evidence for UI changes and full downloadable evidence for critical flows.
- The final branch remains mergeable, unmerged, and green after the template change.

### Validation

- Verify `.github/pull_request_template.md` exists on the PR branch.
- Verify the final PR body contains links rather than only numeric identifiers.
- Verify the final workflow run and artifact reference the final head SHA.
- Verify all required CI and CodeQL checks pass.

## Status

- Original implementation and documentation: complete.
- Pull-request evidence template: implemented.
- PR #7 evidence links: pending final-head CI artifact.
- Merge, release, deployment, publication, and Raspberry changes: not performed.
