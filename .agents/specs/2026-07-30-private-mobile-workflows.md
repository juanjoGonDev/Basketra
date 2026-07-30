# Private mobile workflows

## Request

Complete Basketra as a private, mobile-first application by removing the internal application token, completing shopping-list lifecycle operations, adding safe persisted capture previews, and preserving a fully manual receipt workflow.

## Evidence

- The original browser shell and `/health` were reachable while functional routes returned `401` when `BASKETRA_AUTH_TOKEN` was configured.
- The browser had no supported token acquisition flow.
- The original API supported list create, list, get, and item creation only.
- Capture object URLs were not persisted, so image previews disappeared after reload.
- The original browser tests depended on `prompt()` and did not cover lifecycle, camera, PDF, or persisted preview behavior.

## Decision

1. Remove Basketra's internal bearer-token gate. Access control belongs to the deployment perimeter: loopback/private bind, LAN firewall, VPN, authenticated reverse proxy, or private tunnel.
2. Keep health/readiness minimal, same-origin API access, strict response headers, path validation, body limits, file-signature validation, and no sensitive service-worker caching.
3. Extend the existing REST API and SQLite repository without a framework, ORM, runtime dependency, or additional service.
4. Add incremental safe migration 3 for item completion state.
5. Serve persisted JPEG/PNG previews through a same-origin endpoint backed by `FileStore.read()`, strict storage-key validation, and `private, no-store` caching.
6. Do not serve PDF through the image-preview route.
7. Preserve original uploaded evidence when removing a capture from a browser draft.
8. Keep AI optional; manual extraction, correction, validation, and confirmation remain usable when AI is absent or fails.
9. Expose units, MIME types, and file limit from backend metadata so the browser does not duplicate authoritative configuration.
10. Treat a supplied manual transcription as the combined receipt text: extraction reads one representative stored capture while confirmation preserves every capture as evidence.

## Scope delivered

### Backend

- Removed token configuration and authorization middleware.
- Added `/api/v1/meta` for shared units and file constraints.
- Added shopping-list rename and delete operations.
- Added item edit, quantity delta, completion, restoration, deletion, and deterministic reorder operations.
- Added image-preview responses with generated-key grammar, `FileStore.read()`, content signature validation, `nosniff`, and no-store caching.
- Added stable list/item/storage API error codes.

### Persistence

- Added migration 3 with `completed` and `completed_at` columns.
- Kept existing migrations immutable.
- Added transactional quantity, completion, delete, and reorder behavior.
- Required exhaustive unique reorder payloads.
- Normalized positions after deletion.
- Preserved cascade deletion from lists to products.

### Frontend

- Split browser responsibilities into `api.js`, `state.js`, `lists.js`, `receipts.js`, `ui.js`, and composition in `app.js`.
- Completed list management without `prompt()`.
- Separated pending and completed items.
- Added inline edit, quantity controls, completion, deletion confirmations, and accessible ordering.
- Added dedicated camera and gallery/PDF controls using one upload path.
- Restored persisted image thumbnails through the preview endpoint and displayed accessible PDF placeholders.
- Added capture preview dialog, reorder, and draft removal.
- Kept manual receipt review available after OCR or AI failure.
- Revalidated receipt arithmetic in backend immediately before confirmation.
- Allowed one combined manual transcription to cover multiple preserved receipt captures without invoking OCR for remaining pages.

### Configuration and documentation

- Removed application-token configuration from `.env.example` and both Compose variants.
- Updated product, README, Raspberry, backup, privacy, security, and threat-model documentation.
- Documented network reachability as full authorization and direct public exposure as unsupported.
- Updated the service worker to cache only shell modules and exclude all `/api/` requests.
- Pinned the CodeQL workflow actions to immutable verified commit SHAs.

### Tests

- Unit coverage validates configuration without token and shared unit/MIME sources.
- Integration covers unauthenticated API access, list/item lifecycle, quantity limits, completion, reorder, cascade deletion, migration v1 to v3, image/PDF upload, secure previews, traversal rejection, receipt validation, and backups.
- Static PWA acceptance verifies modular assets, camera attributes, private cache policy, and absence of browser token logic.
- Playwright covers mobile navigation, full list lifecycle, stale suggestions, camera/gallery/PDF, previews, capture ordering, combined manual transcription, AI/OCR recovery, comparison, offline shell, focus, touch targets, and overflow.

## Acceptance criteria

- No active runtime, browser, Compose, script, or operational documentation use of `BASKETRA_AUTH_TOKEN` remains. A regression test may pass the removed variable to prove it is ignored.
- Functional API requests work without `Authorization`.
- Lists can be created, selected, renamed, and deleted.
- Items can be added, edited, completed, restored, deleted, quantity-adjusted, and reordered.
- Migration from schema version 1 or 2 preserves existing list data and initializes completion state safely.
- Camera and file inputs use one validated upload flow.
- Stored JPEG and PNG captures retain safe thumbnails after reload; PDFs use an accessible non-image representation.
- Invalid or traversal storage keys cannot read arbitrary files.
- Receipt extraction remains correctable and confirmable without AI.
- Multiple captures remain attached to a receipt when one combined manual transcription is used.
- Relevant automated checks pass without skips or weakened assertions.
- The pull request includes reproducible browser artifacts and remains unmerged.

## Risks and mitigations

- Removing the token makes accidental public exposure critical. Mitigation: default loopback bind, explicit private-network documentation, same-origin policy, and no supported direct internet exposure.
- Reordering can corrupt positions under partial updates. Mitigation: validate an exhaustive unique item-ID order and update inside one immediate transaction.
- Preview delivery can expose filesystem content. Mitigation: generated-key grammar, `FileStore.read()`, image-only response, magic-byte validation, and no filesystem path input.
- Schema changes can fail on constrained storage. Mitigation: existing validated pre-migration backup and additive migration.
- Browser drafts can reference removed files. Mitigation: fail previews safely and preserve evidence rather than deleting files during this task.
- A trusted-network actor has full API access. Mitigation: explicit operator contract and loopback default; public/multi-user authentication remains out of scope.
- A combined manual transcription could appear to discard additional pages. Mitigation: use one capture only for extraction input while retaining all captures in the confirmation payload and persisted evidence.

## Rollback

- Revert the feature commits and deploy the previous immutable image.
- For a schema-incompatible application rollback, restore the validated pre-migration database backup created by the migration runner.
- Uploaded evidence remains preserved and can be cleaned only under a separately specified reference-aware retention policy.

## Validation

- Local repository checkout was unavailable because the execution environment could not resolve or connect to GitHub.
- TypeScript edge behavior was reproduced locally with TypeScript 5.8.3 and corrected without weakening `exactOptionalPropertyTypes`.
- Pull Request Quality run `30588689292` passed:
  - `✅ Quality`, including format, lint, strict typecheck, dead code, dependency checks, unit, integration, static E2E, 100% domain coverage, build, and resource budgets;
  - `🔒 Security`;
  - `🌐 Browser E2E`, all eight mobile Chromium flows without retries;
  - `🧪 Container smoke`;
  - `📦 Container (linux/amd64)`;
  - `📦 Container (linux/arm64)`.
- CodeQL Advanced run `30588689263` passed for Actions and JavaScript/TypeScript.
- GHCR publication was skipped as designed for a pull-request event.
- Final browser evidence artifact `basketra-browser-evidence` was uploaded as artifact `8777525250`, size 69,005,304 bytes, digest `sha256:7a3e5ae21d56554d6ee97288002404a4582775f00590be685c143e7ac66d59bb`, expiring 2026-08-06.
- The final status-only trace commit is subject to the same required pull-request and CodeQL checks before merge eligibility.

## Delivery

- Branch: `agent/fix-private-mobile-workflows`.
- Pull request: normal, non-draft PR #7 to `main`.
- Pull request remains open and mergeable.
- Merge, deployment, release, GHCR publication, and Raspberry changes are explicitly excluded.

## Status

- Reconnaissance: complete.
- Specification: complete.
- Implementation: complete.
- Documentation: complete.
- Automated validation: complete on the implementation and documentation trace heads.
- Delivery: PR #7 open, non-draft, unmerged, and ready for review after required checks.
