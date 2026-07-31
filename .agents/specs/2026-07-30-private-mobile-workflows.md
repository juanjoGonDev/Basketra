# Private mobile workflows

## Request

Complete Basketra as a private, mobile-first application by removing the internal application token, completing shopping-list lifecycle operations, adding safe persisted capture previews, preserving a fully manual receipt workflow, and making all user-visible pull-request evidence directly reviewable without downloading ZIP archives.

## Evidence

- The original browser shell and `/health` were reachable while functional routes returned `401` when `BASKETRA_AUTH_TOKEN` was configured.
- The browser had no supported token acquisition flow.
- The original API supported list create, list, get, and item creation only.
- Capture object URLs were not persisted, so image previews disappeared after reload.
- The original browser tests depended on `prompt()` and did not cover lifecycle, camera, PDF, or persisted preview behavior.
- The pull request originally exposed browser evidence only through a downloadable Actions artifact, which required reviewers to download and extract a ZIP before seeing screenshots or recordings.

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
11. User-visible PR evidence must appear directly in the PR as screenshots and GIFs, with direct full-video links where useful. ZIP files and artifact-download pages are internal transport only and do not count as review evidence.
12. Generated visual media must not be committed to Git. Publish it temporarily as assets of a PR-specific GitHub prerelease, replace it on every head update, and delete it when the PR closes.
13. The privileged publishing workflow must never checkout or execute PR-controlled code. It may publish only for same-repository PRs authored by an owner, member, or collaborator, and only after the authoritative browser workflow succeeds for the exact head SHA.

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
- Added `.github/pull_request_template.md`, which rejects ZIPs, artifact IDs, local paths, stale runs, and downloadable bundles as review evidence.
- Added `pr-visual-evidence.yml`, which waits for the exact successful head run, converts Playwright recordings to direct GIF previews, publishes screenshots/GIFs/WebM files as temporary prerelease assets, and creates or updates one sticky visual comment.
- Added `pr-visual-evidence-cleanup.yml`, which removes the temporary release assets and tag when the PR closes and marks the sticky comment as expired.

### Tests

- Unit coverage validates configuration without token and shared unit/MIME sources.
- Integration covers unauthenticated API access, list/item lifecycle, quantity limits, completion, reorder, cascade deletion, migration v1 to v3, image/PDF upload, secure previews, traversal rejection, receipt validation, and backups.
- Static PWA acceptance verifies modular assets, camera attributes, private cache policy, and absence of browser token logic.
- Playwright covers mobile navigation, full list lifecycle, stale suggestions, camera/gallery/PDF, previews, capture ordering, combined manual transcription, AI/OCR recovery, comparison, offline shell, focus, touch targets, and overflow.
- Repository security policy rejects mutable action references, `pull_request_target`, and excessive top-level permissions for the evidence workflows.

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
- The PR directly renders representative screenshots and critical GIFs generated from its final head SHA.
- Reviewers can open full recordings through direct links without downloading or extracting a ZIP.
- Generated PNG, GIF, and WebM evidence is not committed to the repository.
- Temporary evidence is replaced on PR updates and removed when the PR closes.
- The pull request remains unmerged until explicit approval.

## Risks and mitigations

- Removing the token makes accidental public exposure critical. Mitigation: default loopback bind, explicit private-network documentation, same-origin policy, and no supported direct internet exposure.
- Reordering can corrupt positions under partial updates. Mitigation: validate an exhaustive unique item-ID order and update inside one immediate transaction.
- Preview delivery can expose filesystem content. Mitigation: generated-key grammar, `FileStore.read()`, image-only response, magic-byte validation, and no filesystem path input.
- Schema changes can fail on constrained storage. Mitigation: existing validated pre-migration backup and additive migration.
- Browser drafts can reference removed files. Mitigation: fail previews safely and preserve evidence rather than deleting files during this task.
- A trusted-network actor has full API access. Mitigation: explicit operator contract and loopback default; public/multi-user authentication remains out of scope.
- A combined manual transcription could appear to discard additional pages. Mitigation: use one capture only for extraction input while retaining all captures in the confirmation payload and persisted evidence.
- Temporary prerelease assets are publicly addressable because the repository is public. Mitigation: publish only deterministic synthetic test data, never production data, secrets, user uploads, or environment output.
- A privileged workflow could expose the repository token to untrusted code. Mitigation: no checkout, no execution of PR scripts, same-repository/author-association guard, exact-head validation, minimal job permissions, immutable workflow actions, and no `pull_request_target`.
- Temporary media could remain after an interrupted cleanup. Mitigation: use one deterministic tag per PR, delete and replace it on every update, and run explicit cleanup on close.

## Rollback

- Revert the feature commits and deploy the previous immutable image.
- For a schema-incompatible application rollback, restore the validated pre-migration database backup created by the migration runner.
- Remove the `pr-<number>-visual-evidence` prerelease and tag if the visual-evidence automation must be rolled back independently.
- Uploaded application evidence remains preserved and can be cleaned only under a separately specified reference-aware retention policy.

## Validation

- Local repository checkout was unavailable because the execution environment could not resolve or connect to GitHub.
- TypeScript edge behavior was reproduced locally with TypeScript 5.8.3 and corrected without weakening `exactOptionalPropertyTypes`.
- The application implementation passed the full Pull Request Quality matrix repeatedly: quality, security, Browser E2E, container smoke, AMD64, and ARM64.
- CodeQL passed for Actions and JavaScript/TypeScript after pinning every action reference.
- The visual evidence workflow successfully downloaded the exact-head browser artifact, generated eight PNGs, eight GIFs, and eight WebM recordings, and published them to the deterministic temporary prerelease tag.
- Final workflow, CodeQL, direct-media publication, sticky-comment rendering, and cleanup contracts are verified against the final head before merge; authoritative links remain in PR #7 so this task trace does not require another status-only commit.
- GHCR application publication remains skipped for pull-request events as designed.

## Delivery

- Branch: `agent/fix-private-mobile-workflows`.
- Pull request: normal, non-draft PR #7 to `main`.
- Pull request remains open and mergeable.
- Generated browser media is held only in temporary GitHub release assets, not in Git history.
- Merge, deployment, application release, GHCR publication, and Raspberry changes are explicitly excluded.

## Status

- Reconnaissance: complete.
- Specification: complete.
- Implementation: complete.
- Documentation: complete.
- Automated application validation: complete.
- Direct visual evidence publication: complete pending verification of the final sticky PR comment on the final head.
- Delivery: PR #7 open, non-draft, unmerged, and ready for review after required checks.
