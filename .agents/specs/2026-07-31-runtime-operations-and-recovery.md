# Runtime Operations, Recovery and Release Visibility

## Request

Fix misleading AI configuration failures and add operational controls suitable for the private Raspberry Pi deployment:

- distinguish missing, stale and unreachable AI provider configuration;
- recover automatically after the VPN or private route returns;
- show server uptime and the deployed application version;
- expose bounded, redacted client and server application logs in Settings;
- create backups with an optional direct download;
- import and validate backup files, with an explicit staged restore flow;
- increment the patch version for each trusted release and show that version in the application.

## Evidence

- Production returned `AI_NOT_CONFIGURED` although deployment variables had been edited.
- The supplied environment used obsolete aliases (`BASKETRA_BIND_IP`, `BASKETRA_MEM_LIMIT`, `BASKETRA_CPUS`), included an obsolete application token, and used `127.0.0.1` for an AI service outside the Basketra container.
- Docker Compose only injects the canonical AI variables listed in `compose.raspberry.yml`; changing `.env` does not mutate an already-created container until it is recreated.
- Inside a container, `127.0.0.1` identifies that container, not a service running on the Raspberry host.
- The browser currently checks connectivity only during initialization and browser `online`/`offline` events. VPN route changes do not reliably emit those events.
- Diagnostics expose `startedAt` but the UI renders a static JSON snapshot.
- Manual backups can be created but cannot be downloaded or imported from the application.
- The package version is `0.1.0` and the published image does not carry an independently visible release version.
- Existing backend failures are written to stderr but there is no bounded application log stream visible from Settings.

## Decisions

1. Preserve the existing `BasketraServer` as the application owner and place a dependency-free operations gateway in front of it. The inner server listens on an ephemeral loopback port; the gateway owns the configured public port and proxies existing routes.
2. The gateway owns only cross-cutting operations: runtime metadata, AI diagnostics, bounded logs, backup download/import/staged restore and request telemetry.
3. AI settings report `configured`, missing fields, a loopback-in-container warning and a connection-test result. Missing configuration and unreachable configuration are different error states.
4. Raspberry Compose maps `host.docker.internal` to the host gateway and documents it as the canonical host-service address. Obsolete deployment aliases are rejected in documentation rather than retained as parallel configuration owners.
5. Connectivity uses one visibility-aware adaptive heartbeat: slow while healthy, fast while disconnected, paused while hidden, with request timeout and stale-result suppression. A recovered route refreshes operational state and emits a recovery event; the loop never permanently stops after one failure.
6. Uptime is derived in the browser from the server `startedAt` timestamp and updated once per second without polling the server once per second.
7. Server and client events share one structured NDJSON stream under `/data/logs`. Rotation defaults are 10,000 lines or 40 MiB, oldest-file-first, with a bounded number of archives.
8. Client logs are untrusted. The server accepts only a closed, sanitized schema, caps batch size and field length, and rate-limits ingestion. No receipt text, filenames, request bodies, credentials, headers, arbitrary messages or filesystem paths are accepted.
9. Backups remain portable SQLite files. Creation and download are separate actions. Download uses attachment headers and streaming.
10. Imported backups are written to a dedicated staging directory, validated for SQLite integrity and schema version, and never overwrite the active database directly.
11. Restore requires an explicit confirmation phrase. The gateway first creates a portable pre-restore backup, writes an atomic pending-restore marker and exits only after responding. On restart, the pending restore is validated again and atomically applied before the database opens. A failed restore preserves the current database and cannot loop indefinitely.
12. The runtime version is injected at image build time. Development builds show `0.0.0-dev`. Trusted main publication resolves one deterministic semantic version per commit, starting at `1.0.0` when no release exists and incrementing only the patch component thereafter.
13. The verified GHCR publication workflow creates the GitHub release only after the exact image digest has passed registry and runtime verification. Reruns for the same commit reuse the existing version and do not create another release.
14. Generated screenshots, GIFs and videos remain temporary PR assets and are not committed.

## Acceptance

- Settings explains whether AI configuration is missing, loaded but unreachable, or reachable.
- A loopback provider URL inside Docker produces an actionable warning instead of `AI_NOT_CONFIGURED`.
- The deployment guide uses canonical variable names, one variable per line, `host.docker.internal`, and `docker compose ... up -d --force-recreate basketra` after environment changes.
- The removed `BASKETRA_AUTH_TOKEN` is not reintroduced.
- Disconnecting and reconnecting the VPN updates the chip without reloading manually and future health checks continue.
- Settings shows a live uptime counter, start time and deployed version.
- Settings shows bounded redacted client/server logs and supports manual refresh.
- Creating a backup offers a direct download without automatically forcing one.
- A local `.db` file can be imported, validated and staged; restore requires explicit confirmation and preserves a pre-restore backup.
- Invalid, oversized, unsupported or future-schema backups are rejected without changing the active database.
- Release publication assigns one patch-incremented version to the validated commit and exposes it in the app and OCI labels.
- Unit, integration and Playwright tests cover configuration states, heartbeat recovery, uptime, logs, backup download/import/restore staging and version rendering.
- Quality, security, CodeQL, container smoke, AMD64, ARM64 and direct visual evidence pass on the final head.

## Security and Privacy

- Credentials shown in chat are treated as compromised and must be rotated outside this repository.
- API keys are never returned; only an existing last-four mask may be displayed.
- Logs contain allowlisted metadata only and are stored under bounded retention.
- Backup names are server-generated or strictly validated; path traversal is rejected.
- Imported databases are size-bounded, staged with owner-only permissions and validated before any marker can be written.
- Restore is a deliberate destructive operation with confirmation, a pre-restore backup and startup-time atomic replacement.
- No browser endpoint can read Docker configuration, process environment, registry credentials or arbitrary host logs.

## Tests

- Unit tests for log sanitization/rotation, semantic version resolution and restore marker validation.
- Integration tests for AI settings states, logs, streamed backup download, import validation, restore staging and startup apply/rollback.
- Playwright mobile and desktop flows for Settings, live uptime, client/server logs, backup create/download/import confirmation and VPN-route recovery.
- Existing OCR, receipt, list, security and multi-architecture suites remain green.

## Rollback

Revert the PR. Before rollback after a restore, keep the generated pre-restore backup and follow the offline restore runbook. The feature adds no schema migration.

## Delivery

Branch `agent/feat-runtime-operations`; draft PR pending implementation and validation. No merge, release, deployment, secret rotation or Raspberry mutation is performed by this task.

## Status

- Reconnaissance: complete.
- Specification: complete.
- Implementation: in progress.
- Validation: pending.
- Visual evidence: pending.
- Delivery: pending.
