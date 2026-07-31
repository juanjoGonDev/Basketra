# Photo upload reliability and observability

## Request

Fix the production `500` returned when uploading a receipt photo, add actionable backend logging, and cover the real mobile upload workflow comprehensively with Playwright.

## Evidence

- Raspberry Compose mounts persistent files under `/data` and temporary files under the `/tmp/basketra` tmpfs.
- The previous `FileStore.storeBase64()` wrote to the configured temporary directory and then called `renameSync()` into the persistent directory.
- POSIX rename cannot cross filesystems. Docker therefore returned `EXDEV` when moving from tmpfs to the persistent volume.
- Previous unit, integration, and Playwright tests placed temporary and persistent directories on the same filesystem, so they could not reproduce the deployed failure.
- Unexpected server failures returned a generic `500` without an actionable stderr event.

## Decision

1. Keep atomic publication, but create the staging file beside its final destination in persistent storage before renaming it on the same filesystem.
2. Remove interrupted `.upload` staging files during `FileStore` initialization and exclude them from persistent-file accounting.
3. Emit one structured JSON error event to stderr for unexpected failures. Include an incident reference, error name, safe system error code, and syscall. Never log request bodies, receipt text, headers, credentials, storage paths, filenames, raw filesystem messages, or stack traces.
4. Include the incident reference in the generic `500` message so browser feedback can be correlated with container logs.
5. Run Playwright with its temporary directory on `/dev/shm` in CI while application data remains in the workspace, reproducing the same cross-filesystem boundary as Raspberry Docker.
6. Use valid image files and cover successful camera upload, gallery upload, deduplication, persistent preview reload, recoverable server failure, draft preservation, retry, browser runtime errors, and horizontal overflow.
7. Add unit and API integration regression tests that assert temporary and persistent directories are on different devices under Linux CI.

## Acceptance criteria

- Uploading a valid JPEG or PNG no longer returns `500` when temporary and persistent directories are on different filesystems.
- A duplicate upload returns the same storage key without rewriting the file.
- Interrupted staging files are removed safely at startup.
- Unexpected backend failures emit a redacted structured stderr event with a correlation reference.
- The browser displays the incident reference returned by the backend and preserves already uploaded captures.
- Retrying after a transient upload failure succeeds without reloading or losing the draft.
- Playwright executes against a cross-filesystem layout in CI with no retries, page errors, unexpected console errors, failed requests, or horizontal overflow.
- Unit, integration, static E2E, browser E2E, security, build, amd64/arm64 container checks, resource budgets, and CodeQL pass.

## Scope delivered

### Storage

- Staging files are created with exclusive mode `0600` beside the final persistent object.
- Final publication remains an atomic same-filesystem rename.
- Staging files are removed after success or failure and stale `.upload` files are removed at startup.
- Existing SHA-256 deduplication, MIME allowlisting, signature validation, body limits, and persistent-storage budgets remain enforced.

### Observability

- Unexpected failures write one JSON event with `event=http.unexpected_error`, incident ID, error name, optional system code, and optional syscall.
- Raw messages, paths, receipt data, filenames, request bodies, headers, credentials, and stacks are excluded.
- The HTTP `500` includes the same incident reference for operator correlation.

### Tests

- Unit regression covers separate devices, atomic persistence, deduplication, stale staging cleanup, file permissions, and redacted logging.
- API integration uploads and previews valid JPEG and PNG files with persistent storage and `/dev/shm` on different devices.
- Playwright now runs ten mobile Chromium flows without retries. The two new flows cover:
  - camera and gallery uploads, duplicate content, persisted previews after reload, full preview, runtime errors, and responsive overflow;
  - a transient backend `500`, visible incident reference, preserved draft, successful retry, and loaded previews.

## Risks

- Logging raw exception messages could expose paths or receipt data. Mitigation: fixed structured fields only; no raw message or stack.
- Staging in the persistent directory briefly consumes persistent storage. Mitigation: bounded request/storage limits, exclusive staging files, startup cleanup, same-filesystem atomic rename, and final cleanup.
- `/dev/shm` is Linux-specific. Mitigation: use it only under CI; local Playwright retains the portable repository temporary directory.

## Rollback

Revert this change. No schema or persisted-data migration is involved. Existing stored receipts remain compatible.

## Validation

Implementation head `affd0d681bcfab80de3fec06281e69b33ef37857` passed:

- Pull Request Quality run `30613379008`:
  - `✅ Quality`, including format, lint, strict typecheck, dead-code/dependency checks, unit tests, integration tests, static E2E, build, coverage, and resource budgets;
  - `🔒 Security`;
  - `🌐 Browser E2E`, ten mobile Chromium flows without retries;
  - `🧪 Container smoke`;
  - `📦 Container (linux/amd64)`;
  - `📦 Container (linux/arm64)`.
- CodeQL Advanced run `30613379035` passed.
- Direct visual-evidence run `30613379007` passed.
- GHCR publication was skipped as designed for a pull-request event.

The final documentation-only trace commit must pass the same required checks before merge eligibility.

## Delivery

- Branch: `agent/fix-photo-upload-observability`.
- Pull request: normal, non-draft PR #8 to `main`.
- Merge, release, deployment, GHCR publication, and Raspberry mutation are excluded.

## Status

- Reconnaissance: complete.
- Specification: complete.
- Regression implementation: complete.
- Validation: complete on the implementation head.
- Delivery: PR #8 open, non-draft, and unmerged; final trace checks pending.
