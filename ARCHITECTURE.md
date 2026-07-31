# Architecture

## Shape

Basketra is a modular monolith with one Node.js process:

```text
Mobile PWA
  -> same-origin operations gateway
    -> application HTTP server
      -> deterministic domain modules
      -> SQLite + mounted files
      -> optional ephemeral OCR / AI / offer providers
    -> bounded logs + runtime metadata + backup/restore control
```

The operations gateway and the application server are two in-process HTTP boundaries, not separate services or processes. The gateway owns the configured public socket. The application server listens on an ephemeral loopback port and remains the owner of list, receipt, optimization, file, migration, and database behavior.

## Boundaries

- `src/domain`: pure money, units, matching, receipt validation, offers, optimization, and runtime validation.
- `src/infrastructure`: configuration, identifiers, SQLite migrations/repositories, and secure file storage.
- `src/ai`, `src/ocr`, `src/offers`: provider-neutral contracts and adapters.
- `src/api`: application HTTP boundary, validation, error mapping, and static PWA delivery.
- `src/operations`: cross-cutting runtime metadata, redacted log storage, AI connection diagnostics, streamed backup download/import, staged startup restore, and version ownership.
- `src/web`: mobile-first PWA shell and a single operations console.
- `scripts/release-version-policy.mjs`: trusted-release semantic version assignment; the runtime never calculates its own release number.

## Dependency direction

The domain does not import HTTP, SQLite, filesystem, OCR, AI, operations, or retailer integrations. External effects depend on domain contracts. Provider lifecycle is explicit and disposable.

The operations gateway depends on the application server as an adapter. It proxies existing API/static routes and intercepts only cross-cutting operational routes. It does not duplicate domain validation, database queries, OCR orchestration, or receipt logic.

## Data integrity and recovery

SQLite enables WAL, foreign keys, busy timeout, explicit migrations, transactional receipt import, immutable price observations, and FTS5 product search. Money uses integer minor units. Quantities and normalized prices use integer rational pairs.

Manual backups are portable SQLite copies. Downloads stream from a fixed directory. Imports stream to a generated staging file, hash incrementally, and validate integrity/schema before atomic publication. Restore is never applied to an open database: the gateway creates a pre-restore backup and atomic marker, exits, and startup validates and atomically applies the replacement before constructing `BasketraDatabase`.

## Observability

The canonical application stream is bounded NDJSON under the persistent data directory. Server and sanitized client events share a closed schema and a `source` field. Rotation uses line and byte ceilings and removes oldest archives first. Docker process logs remain separate for startup/native failures.

The browser computes uptime from one server timestamp. It does not poll diagnostics every second.

## Resource model

There is no Redis, broker, database server, browser process, OCR daemon, resident AI worker, or unbounded queue. Heavy providers are loaded only for a request and disposed. Backup import streams to disk instead of buffering the database.

The only recurring browser work is a minimal, visibility-aware private-route heartbeat: 15 seconds while healthy, 2 seconds while disconnected, a 4-second timeout, and no checks while hidden. It is intentionally separate from domain synchronization and cannot enqueue overlapping requests.
