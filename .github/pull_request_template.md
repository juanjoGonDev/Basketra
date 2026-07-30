## What

<!-- Describe the behavior delivered, not only the files changed. -->

## Why

<!-- Explain the user problem, failure mode, or requirement addressed. -->

## Impact

- User-visible behavior:
- API/contracts:
- Data/migrations:
- Security/privacy:
- Operations/deployment:

## Validation

<!-- List the exact commands, workflow runs, and relevant checks executed. -->

- Local/CI checks:
- Workflow run:
- CodeQL/security run:

## Evidence — required

<!--
This section is mandatory.

For UI, UX, responsive, browser, camera, upload, navigation, or other user-visible changes:
1. Insert representative screenshots or GIFs directly in this PR body using Markdown.
2. Link the complete browser artifact containing screenshots, videos, and traces.
3. Link the successful workflow run that generated the artifact.
4. Ensure the run and artifact correspond to the current final head SHA.
5. Cover every changed screen and the important loading, empty, error, success, offline, permission, and responsive states that apply.

Do not provide only an artifact ID, run ID, local path, temporary signed URL, or plain text reference. Links must be clickable and accessible from GitHub.

For changes with no user-visible behavior, write "Not applicable" and explain why.
-->

- Final head SHA:
- Successful workflow run:
- Complete browser evidence artifact:
- Inline screenshots/GIFs:
- Videos/traces:

## Risk and rollback

- Risks:
- Mitigations:
- Rollback procedure:

## Delivery checklist

- [ ] The PR title follows Conventional Commits.
- [ ] Acceptance criteria are covered by tests.
- [ ] Strict type checking, lint, tests, build, security, and relevant architecture checks pass.
- [ ] Migrations are incremental, tested from an empty database and a realistic upgrade path, and include rollback/recovery instructions.
- [ ] No secrets, credentials, private data, debug output, or unrelated changes are included.
- [ ] User-visible changes include inline screenshots or GIFs in this PR body.
- [ ] Critical user flows include downloadable video/trace evidence.
- [ ] Evidence links are clickable and point to artifacts generated from the final head SHA.
- [ ] The complete evidence artifact is linked, not referenced only by ID.
- [ ] Documentation and the task specification are updated.
- [ ] Merge, release, deployment, publication, and remote migrations were not performed without explicit approval.
