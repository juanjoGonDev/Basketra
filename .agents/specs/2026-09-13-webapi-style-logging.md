# WebAPI-style application logging

## Request
Provide Basketra with the same operational logging ergonomics as WebAPI: readable, structured coloured terminal output, request correlation, bounded on-disk history and the existing safe Settings log view.

## Evidence
- Basketra currently persists a narrow NDJSON operations event schema, but ordinary successful requests are not recorded and the development terminal only receives two raw JSON `console.log` lines from startup.
- WebAPI provides timestamped colour-coded levels, contextual children, request identifiers, duplicate suppression, a bounded file sink and readable terminal output.
- Basketra already owns `/data/logs`, rotation and redacted client-log ingestion. The implementation must extend rather than create a second log ownership model.

## Scope
- Add a dependency-free shared server logger with trace/debug/info/success/warn/error/tool levels, child contexts, request IDs, safe component contexts, ANSI terminal formatting where supported, and plain output when not interactive.
- Use the existing bounded `ApplicationLogStore` as its persistent structured sink.
- Log every gateway request once at completion, including successful proxy/direct requests, method, path, status and duration without query strings or bodies.
- Retain safe bounded Settings retrieval and client-event ingestion; never record receipt content, filenames, credentials, bodies, headers or filesystem paths.
- Prevent high-frequency identical log entries from flooding console or persisted history.
- Add focused unit and integration regressions for formatting, redaction, duplicate suppression and successful request logging.

## Decisions
1. `ApplicationLogStore` remains the only persistent owner under `/data/logs`; no new runtime dependency or unbounded file is introduced.
2. Server logging defaults to readable terminal output and structured persisted records. Settings remains the authorised private operator viewer.
3. Automatic request logging runs from gateway response completion so direct and proxied routes use identical records and timing.
4. The persisted schema remains allowlisted. Human text belongs to terminal only; Settings events carry safe event codes/metadata.
5. Logging settings are not a competing provider configuration surface. Stable bounded defaults preserve Raspberry operation.

## Acceptance
- Starting Basketra produces WebAPI-style timestamp/level/context terminal logs.
- A successful request emits exactly one redacted `http.request_completed` event with correlation ID, method, path, status and duration.
- Errors retain a useful safe code and warn/error levels.
- `GET /api/v1/logs` exposes the same bounded server/client history as before.
- Secrets, receipt payloads, filenames, paths outside request routes, query values, headers and raw error stacks are absent from the persisted schema and terminal request line.
- Repeated identical messages are suppressed within a short window and later report their suppressed count.
- Unit/integration tests and full quality pass.

## Rollback
Revert the logger, gateway wiring and associated tests. Existing log files remain valid NDJSON and are still read by `ApplicationLogStore`.
