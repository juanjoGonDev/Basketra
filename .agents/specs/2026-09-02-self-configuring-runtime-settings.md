# Self-configuring runtime settings

## Request

Make the Basketra image boot and remain operable without an operator-managed `.env` file. Settings that currently require editing Basketra environment variables and recreating the container must instead be editable from Basketra Settings, persisted in SQLite, and applied to the next relevant operation without restarting the container.

## Evidence

- Before this task, `src/infrastructure/config.ts` read AI provider URL/token/model/retries/capability flags, Overpass URL, upload/body limit and idle behavior from environment variables.
- Before this task, `src/operations/gateway.ts` reported `requiresContainerRecreate: true`, named missing `BASKETRA_AI_*` variables, and told the operator to recreate the container.
- Before this task, `src/web/operations.js` repeated that environment/recreate workflow in the visible Settings UX.
- Before this task, `compose.raspberry.yml` forwarded the same functional settings into the container even though Basketra already owns a persistent SQLite volume.
- The root deployment contract states that Basketra is a single-user LAN/VPN application and operator-adjustable runtime settings should be persisted/configurable through the app instead of owned by environment variables.
- WebAPI `/v1/capabilities` remains the canonical owner of AI/provider attachment limits; Basketra must not recreate those provider limits locally.

## Scope

### Included

- SQLite-backed Basketra instance settings for AI provider URL, API token, model and retry count;
- SQLite-backed Overpass base URL, local upload/body limit and idle-hibernation delay;
- GET/PUT Settings API with runtime validation, secret masking and explicit secret clear semantics;
- Settings UI that can edit/save/test the provider without environment files or container recreation;
- immediate next-operation application of settings, including invalidation/reconstruction of cached provider and Responses clients;
- dynamic Overpass and local upload/body/hibernate behavior from the same runtime owner;
- image/container defaults for host, port, data and temporary paths so the runtime image does not need Basketra application ENV values;
- removal of obsolete Basketra functional ENV wiring and documentation;
- regression coverage for persistence, secret handling, runtime updates and no-env boot.

### Excluded

- exposing the Docker socket to Basketra;
- changing container CPU/RAM limits, host-port binding, image tag or Watchtower lifecycle from the application UI;
- moving WebAPI attachment/capability limits into Basketra;
- deployment, release, merge or remote migration.

## Decisions

1. The Settings UI does not edit a `.env` file. SQLite is the canonical mutable owner because writing `.env` would still require a container recreate and would retain two sources of truth.
2. Container orchestration values are not application settings. The Raspberry Compose file supplies safe fixed/default orchestration values and can be used without a `.env` file. Basketra never receives Docker daemon access.
3. Startup-only application paths are image defaults: container host `0.0.0.0`, port `3000`, data `/data`, temporary files `/tmp/basketra`; local non-container execution uses loopback and repository-local data/temp defaults.
4. The API token is write-only. GET responses expose only a mask. Omitting `apiKey` preserves the stored token; `apiKey: null` explicitly clears it.
5. Saving AI connection identity disposes cached provider/Responses clients so the next operation uses the new URL/token/model. In-flight operations retain the configuration they started with.
6. Static image/PDF environment capability toggles are removed as operator policy. WebAPI remains the capability/limit owner; Basketra uses its provider contract and live WebAPI capability endpoint rather than configurable duplicate limits.
7. Local request/upload size remains a Basketra runtime operational guard because it bounds Basketra's own request buffering/storage boundary, not WebAPI's AI attachment policy. It is visible and editable in Settings.
8. Idle hibernation is a Basketra process-local optimization and is runtime configurable. Idle process exit is removed from normal runtime configuration; containers should remain supervised by Docker.
9. Overpass URL is read for each nearby-store operation from the runtime owner so a saved change takes effect without restart.
10. Settings writes are validated server-side and persisted transactionally before runtime caches are invalidated.

## Acceptance

- `docker compose -f compose.raspberry.yml up -d` does not require a `.env` file to start Basketra with persistent `/data` and temporary `/tmp/basketra` paths.
- Basketra starts with AI unconfigured and the UI provides fields to configure WebAPI URL, model and token.
- Saving provider settings does not require or suggest a container restart.
- The API token is never returned in plaintext by a Settings GET or diagnostics endpoint.
- A saved provider URL/model/token survives process/container restart through the existing SQLite volume.
- Changing provider settings affects the next provider test, receipt AI operation and Responses operation without process restart.
- Changing AI retries affects the next structured AI operation.
- Changing Overpass URL affects the next nearby-store lookup.
- Changing Basketra local upload/body limit affects the next request and is reported through metadata.
- Changing idle hibernation delay reschedules the local hibernation timer without restart.
- No `BASKETRA_AI_*`, `BASKETRA_MAX_BODY_BYTES`, `BASKETRA_OVERPASS_BASE_URL`, `BASKETRA_IDLE_HIBERNATE_AFTER_MS` or `IDLE_EXIT_AFTER_MS` is required or consumed as a runtime policy source.
- Existing WebAPI capability-cache, durable receipt, backup/restore, Quality, Browser E2E, container, ARM64/AMD64, security and CodeQL checks remain green.

## Tests

- migration/empty-database setup creates the runtime settings table safely;
- runtime settings defaults are deterministic and typed;
- update + reopen preserves non-secret values and token;
- API public projection masks the token and supports preserve/replace/clear semantics;
- provider client is rebuilt after a settings update and the next request uses the new connection identity;
- Overpass and local body-limit updates are observed by the next operation;
- config/bootstrap tests prove application functional environment variables are ignored/not required;
- browser Settings flow saves configuration, shows masked secret state, tests connection and remains responsive/mobile accessible;
- canonical repository quality/CI remains authoritative.

## Risks

- The WebAPI token is stored in Basketra's local SQLite database. This is acceptable for the documented single-user LAN/VPN deployment but means a copy of `basketra.db` contains the credential. Backups must continue to be treated as private data.
- Runtime settings updates while an AI operation is already in flight cannot retroactively change that operation; only subsequent operations use the new snapshot.
- Raising Basketra's local body limit increases local request-memory pressure. Validation therefore keeps a bounded supported range and does not alter WebAPI provider limits.
- A malformed provider/Overpass URL must never be committed; server-side URL validation runs before persistence.

## Rollback

Revert the runtime-settings API/store/UI and bootstrap/compose changes together. Migration 8 is additive and can remain harmlessly present; no destructive downgrade is required.

## Delivery

Continue on `agent/fix-webapi-limit-contract`, PR #50. Companion WebAPI PR #108 remains the dynamic provider-limit owner. No merge, release, deployment, publication, secret mutation outside Basketra SQLite, or remote migration is authorized.

## Status

Implementation is prepared. Exact-head CI and final runtime/UI evidence remain mandatory delivery gates; any failure discovered there reopens implementation rather than being accepted as a documentation-only exception.
