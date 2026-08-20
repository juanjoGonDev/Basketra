# Visual evidence impact policy

## Request

Generate and publish pull-request visual evidence only when the current PR changes rendered web source under `src/web/**` or a canonical Basketra dependency/workspace manifest. Dependency updates must remain visual-evidence eligible even when no web source file changes.

## Evidence

- `.github/workflows/pr-visual-evidence.yml` is triggered directly by `pull_request` events (`opened`, `synchronize`, `reopened`, `ready_for_review`) and previously started for every trusted same-repository PR.
- Before this change the workflow waited for the authoritative `Pull Request Quality` run for the PR `HEAD_SHA`, downloaded `basketra-browser-evidence`, prepared media, replaced a temporary prerelease, and updated the PR comment without first classifying changed files.
- Basketra uses `pnpm@10.15.0` from root `package.json`.
- The repository has one root dependency manifest (`package.json`), one lockfile (`pnpm-lock.yaml`), and one pnpm workspace manifest (`pnpm-workspace.yaml`). The workspace currently contains only `.` and there are no nested package manifests.
- GitHub PR file records expose the current `filename` and, for renames, `previous_filename`; both paths must be considered so moving a web file out of `src/web/**` cannot incorrectly skip evidence.
- Existing exact-head protection uses the event `HEAD_SHA`, same-SHA quality-run lookup, and workflow concurrency. Publication now also re-reads the PR head immediately before release/comment mutation.

## Scope

- Add one canonical, dependency-free changed-path policy helper under `scripts/`.
- Add focused unit coverage for RUN/SKIP decisions.
- Gate expensive work in `.github/workflows/pr-visual-evidence.yml` behind that helper.
- Preserve the existing media selection, authoritative Browser E2E dependency, release/comment format, permissions, and reliability safeguards.
- Do not change product/runtime behavior, Browser E2E execution policy, dependency versions, deployment, release automation, or cleanup behavior.

## Decision

Use `scripts/pr-visual-evidence-policy.mjs` as the single source of truth for visual-impact paths.

The policy is true when any changed/current/previous path is:

1. under `src/web/`; or
2. exactly one of:
   - `package.json`
   - `pnpm-lock.yaml`
   - `pnpm-workspace.yaml`

Split the workflow by trust boundary:

1. A read-only `classify` job runs only for the same trusted same-repository actor set already accepted by the publisher.
2. That job checks out the exact PR head using the repository's pinned `actions/checkout`, queries every PR-files page with `gh api --paginate`, serializes only `filename` and `previous_filename`, and executes the dependency-free policy helper with `GH_TOKEN` removed from the helper process environment.
3. The classifier emits `required=true|false` and a clear reason. A false result ends as a successful no-op; the privileged publisher job is not scheduled.
4. The existing write-capable `publish` job depends on `classify` and runs only when `required == 'true'`. It does not check out or execute PR code.
5. The publisher retains the same-SHA authoritative Quality lookup before artifact/media work.
6. The publisher re-reads `.head.sha` immediately before release mutation and again before comment mutation, failing closed if it differs from the event `HEAD_SHA`.

Do not use broad extensions such as every JSON/YAML/lock file, commit messages, labels, workflow names, or Browser E2E execution as impact signals.

## Acceptance

- `src/web/app.js`, `src/web/modern.css`, `src/web/ui.js`, new/deleted web paths, and old paths from web-file renames classify as RUN.
- `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml` classify as RUN.
- Dependency/workspace files mixed with `.github/**` or documentation still classify as RUN.
- `.github/workflows/pr-visual-evidence.yml` alone, tests alone, `.agents/**` alone, docs/Markdown alone, backend source alone, Docker/Compose alone, and `.github/**` plus tests classify as SKIP.
- A mixed set containing at least one triggering path classifies as RUN.
- SKIP runs do not wait for Quality, download browser artifacts, install `ffmpeg`, process media, mutate the temporary release, or create/update the visual-evidence comment.
- RUN behavior preserves the existing exact-head authoritative Browser E2E and media publication flow.
- Publication fails closed when the PR current head differs from the event head.
- The write-capable publisher does not check out or execute PR-head code.
- No third-party changed-files action or dependency is added.
- Canonical project quality/security checks and final exact-head PR CI are green.

## Tests

- Unit table tests cover every required RUN/SKIP path class.
- Unit coverage verifies renamed-file `previous_filename` extraction and classification.
- Workflow contract tests verify read-only early classification, privileged-job gating, all-page PR file retrieval, current-head verification, same-SHA Quality lookup, and preservation of existing media reliability safeguards.
- PR #33 itself is the live SKIP case because it changes only workflow/spec/test/helper files and no `src/web/**` or dependency/workspace owner file.

## Validation

Implementation head `4e4efd390a0ce7f9a4b4668164093d81b69118d0`:

- Pull Request Quality run `32355122708`: passed. Quality, Security, container smoke, `linux/amd64`, `linux/arm64`, and Browser E2E all completed successfully.
- Browser E2E job `96382697853`: **48/48 Chromium tests passed**. The changed-code coverage gate correctly reported that no browser production paths changed.
- CodeQL Advanced run `32355122766`: passed.
- Publish PR visual evidence run `32355122811`: passed as the intended no-op. `🔎 Classify visual impact` completed successfully and `🖼️ Publish direct PR evidence` was skipped, so no authoritative-browser wait, artifact download, `ffmpeg` setup, media processing, temporary release mutation, or PR evidence comment mutation ran.
- The live classifier log reported: `Visual evidence skipped: no src/web/** or canonical dependency/workspace files changed.`
- The classifier used only `contents: read` and `pull-requests: read`, checked out the exact PR head, retrieved paginated PR-file metadata, and removed `GH_TOKEN` from the policy-helper process.
- The first CI pass on the preceding head exposed one overly strict workflow-test regex while all new policy RUN/SKIP tests passed; commit `4e4efd390a0ce7f9a4b4668164093d81b69118d0` corrected that test without changing production behavior, and the complete canonical gate then passed.

## Checks

- `pnpm quality`: executed by the canonical Quality job and passed; this includes the repository unit-test command and the new policy/workflow contracts.
- Pull Request Quality: passed on the implementation head.
- CodeQL Advanced: passed on the implementation head.
- Publish PR visual evidence: passed as a classification-only no-op on the implementation head.
- Manual workflow-log inspection: confirmed the nonvisual PR does not schedule the privileged publisher.

## Risks

- GitHub's PR-files endpoint is paginated; missing pagination could produce false SKIP decisions on large PRs. The workflow uses `--paginate` and regression coverage protects that contract.
- Renames expose the new path as `filename`; ignoring `previous_filename` could miss a web file moved outside `src/web/**`. The helper and tests consume both paths.
- A stale run could mutate release/comment state after a newer push unless the head is revalidated immediately before publication. The publisher now fails closed before both mutation boundaries.
- Running PR-head policy code inside a write-capable job would violate the privileged-job trust boundary; the classifier is isolated in a read-only job and removes `GH_TOKEN` from the helper process.

## Rollback

Revert the workflow gate, policy helper, tests, and this spec. No application state, schema, API, dependency, release, or deployment migration is involved.

## Delivery

Branch: `agent/ci-visual-evidence-impact`.

PR: #33, `fix(ci): gate visual evidence by frontend impact`, targeting `main` as a non-draft pull request.

Do not merge without explicit user approval.

## Status

Complete. The implementation behavior and the live nonvisual SKIP path are validated; this closing documentation-only commit remains subject to the same exact-head CI gate before delivery is reported final.
