# Private mobile workflows

## Request

Complete Basketra as a private, mobile-first application by removing the internal application token, completing shopping-list lifecycle operations, adding safe persisted capture previews, and preserving a fully manual receipt workflow.

## Evidence

- The browser shell and `/health` are public, but `BasketraServer.handle()` authorizes every other route when `BASKETRA_AUTH_TOKEN` is configured.
- The browser client has no supported token acquisition flow.
- Raspberry deployment configuration can therefore make the shell usable while functional API calls return `401`.
- Shopping lists currently support create, list, get, and item creation only.
- The branch already contains visible list creation and separate camera/file inputs, but list editing, deletion, completion, quantity changes, reordering, and persisted image previews are not implemented end to end.
- Capture object URLs are intentionally not persisted, so image previews disappear after reload.

## Decision

1. Remove Basketra's internal bearer-token gate. Access control belongs to the deployment perimeter: loopback/private bind, LAN firewall, VPN, authenticated reverse proxy, or private tunnel.
2. Keep health/readiness minimal, same-origin API access, strict response headers, path validation, body limits, file-signature validation, and no sensitive service-worker caching.
3. Extend the existing REST API and SQLite repository rather than introducing a framework, ORM, runtime dependency, or service.
4. Add an incremental safe migration for item completion state.
5. Serve persisted capture previews through a same-origin endpoint backed by `FileStore.read()`, with strict storage-key validation and `no-store` caching.
6. Preserve original uploaded evidence when removing a capture from a browser draft.
7. Keep AI optional; manual extraction, correction, validation, and confirmation remain usable when AI is absent or fails.

## Scope

### Backend

- Remove token configuration and authorization middleware.
- Add shopping-list rename and delete operations.
- Add item update, completion, delete, and deterministic reorder operations.
- Add persisted file preview responses for supported image types and safe PDF metadata handling.
- Keep stable API error codes and transactional ordering updates.

### Persistence

- Add migration version 3 with `completed` and `completed_at` columns.
- Keep existing migrations immutable.
- Preserve contiguous item positions after delete and reorder.

### Frontend

- Complete list management without `prompt()`.
- Separate pending and completed items.
- Add inline edit, quantity controls, completion, deletion, and keyboard-accessible ordering.
- Reuse one upload path for camera, gallery, and PDF.
- Restore persisted image thumbnails after reload through the preview endpoint.
- Keep manual receipt review available after AI or extraction failure.

### Delivery

- Update deployment and security documentation.
- Add unit, integration, static PWA, and Playwright regression coverage.
- Run the repository quality workflow and Docker checks where the available runner supports them.
- Open a normal pull request and do not merge, deploy, or release.

## Acceptance criteria

- No runtime, browser, compose, test, script, or documentation reference to `BASKETRA_AUTH_TOKEN` remains.
- Functional API requests work without `Authorization`.
- Lists can be created, selected, renamed, and deleted.
- Items can be added, edited, completed, restored, deleted, quantity-adjusted, and reordered.
- Migration from schema version 2 preserves existing list data and initializes completion state safely.
- Camera and file inputs use one validated upload flow.
- Stored JPEG and PNG captures retain safe thumbnails after reload; PDFs use an accessible non-image representation.
- Invalid or traversal storage keys cannot read arbitrary files.
- Receipt extraction remains correctable and confirmable without AI.
- Relevant automated checks pass without skips or weakened assertions.
- The pull request includes reproducible mobile evidence and remains unmerged.

## Risks

- Removing the token makes accidental public exposure critical. Mitigation: default loopback bind, explicit private-network documentation, same-origin policy, and no supported direct Internet exposure.
- Reordering can corrupt positions under partial updates. Mitigation: validate an exhaustive unique item-id order and update it inside one immediate transaction.
- Preview delivery can expose filesystem content. Mitigation: delegate key parsing and signature validation to `FileStore.read()` and never accept filesystem paths.
- Schema changes can fail on constrained storage. Mitigation: use the existing pre-migration validated backup mechanism and a safe additive migration.
- Browser drafts can reference removed files. Mitigation: fail previews safely and preserve evidence rather than deleting unreferenced files during this task.

## Tests

- Unit: configuration without token, validation boundaries, completion/reorder invariants, file validation and stable errors where logic is isolated.
- Integration: unauthenticated API lifecycle, schema upgrade, list/item CRUD, reorder, persistence, file upload/preview and traversal rejection.
- Browser: no-prompt list lifecycle, quantity/completion/reorder controls, camera and gallery selection, persisted thumbnails, PDF fallback, manual receipt correction and AI failure recovery.
- Existing quality, security, resource, Docker, multi-architecture and service-worker policies remain authoritative.

## Rollback

- Revert the feature commits and deploy the previous immutable image.
- For a schema-incompatible application rollback, restore the validated pre-migration database backup created by the migration runner.
- Uploaded evidence remains preserved and can be cleaned only under a separately specified retention policy.

## Status

- Reconnaissance complete.
- Specification accepted from the supplied task prompt.
- Implementation in progress on `agent/fix-private-mobile-workflows`.
