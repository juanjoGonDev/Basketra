# Photo upload reliability and observability

## Request

Fix the production `500` returned when uploading a receipt photo, add actionable backend logging, and cover the real mobile upload workflow comprehensively with Playwright.

## Evidence

- Raspberry Compose mounts persistent files under `/data` and temporary files under the `/tmp/basketra` tmpfs.
- `FileStore.storeBase64()` writes to the configured temporary directory and then calls `renameSync()` into the persistent directory.
- POSIX rename is not valid across filesystems. Docker therefore returns `EXDEV` when moving from tmpfs to the persistent volume.
- Existing unit, integration, and Playwright tests use temporary and persistent directories on the same filesystem, so the production boundary is not exercised.
- Unexpected server errors are mapped to a generic `500` response without any structured stderr event. The response has a request ID, but operators cannot correlate it with a backend cause.
- The browser error object discards the backend request ID.

## Decision

1. Keep atomic publication, but write the staging file beside its final destination in the persistent directory before renaming it on the same filesystem.
2. Remove interrupted staging files during `FileStore` initialization and exclude them from persistent-file accounting.
3. Emit one structured JSON error event to stderr for failed HTTP requests. Include request ID, method, pathname, mapped status/code, error name, safe system error code and syscall. Never log request bodies, receipt text, headers, credentials, storage paths, filenames, raw filesystem messages, or stack traces.
4. Propagate `requestId` through the browser API error and show it in upload failure feedback so an operator can correlate UI and container logs.
5. Run Playwright with its temporary directory on `/dev/shm` in CI while data remains in the workspace, reproducing the same cross-filesystem boundary as Raspberry Docker.
6. Replace signature-only fake browser images with a valid PNG and cover successful camera upload, gallery upload, deduplication, persistent preview reload, recoverable server failure, draft preservation, retry, and absence of browser runtime errors.
7. Add a container smoke upload through the real `/data` volume plus `/tmp/basketra` tmpfs.

## Acceptance criteria

- Uploading a valid JPEG or PNG no longer returns `500` when temporary and persistent directories are on different filesystems.
- A duplicate upload returns the same storage key without rewriting the file.
- Interrupted staging files are removed safely at startup.
- Unexpected backend failures emit exactly one redacted structured stderr event correlated by `requestId`.
- Browser upload errors include the request ID when supplied by the backend and preserve already uploaded captures.
- Retrying after a transient upload failure succeeds without reloading or losing the draft.
- Playwright executes against a cross-filesystem layout in CI with no retries, page errors, console errors, failed requests, or horizontal overflow.
- Docker smoke proves upload success with `/data` on a volume and `/tmp/basketra` on tmpfs.
- Unit, integration, static E2E, browser E2E, security, build, amd64/arm64 container checks, and CodeQL pass.

## Risks

- Logging raw exception messages could expose paths or receipt data. Mitigation: fixed structured fields only; no raw message or stack.
- Staging in the persistent directory briefly consumes persistent storage. Mitigation: bounded body/storage limits, exclusive staging files, startup cleanup, same-filesystem atomic rename, and final cleanup.
- `/dev/shm` is Linux-specific. Mitigation: use it only under CI; local Playwright retains the portable repository temp directory.

## Rollback

Revert this change. No schema or persisted-data migration is involved. Existing stored receipts remain compatible.

## Validation

Pending CI and direct visual evidence from the final head.

## Delivery

Branch `agent/fix-photo-upload-observability`; normal PR to `main`; no merge, release, deployment, GHCR publication, or Raspberry mutation.

## Status

- Reconnaissance: complete.
- Specification: complete.
- Regression implementation: in progress.
- Validation: pending.
- Delivery: pending.
