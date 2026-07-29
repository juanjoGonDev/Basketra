# Architecture

## Shape

Basketra is a modular monolith with one Node.js process:

```text
Mobile PWA
  -> same-origin HTTP API
    -> deterministic domain modules
    -> SQLite + mounted files
    -> optional lazy OCR / AI / offer providers
```

## Boundaries

- `src/domain`: pure money, units, matching, receipt validation, offers, optimization, runtime validation.
- `src/infrastructure`: configuration, identifiers, SQLite migrations/repositories, secure file storage.
- `src/ai`, `src/ocr`, `src/offers`: provider-neutral contracts and adapters.
- `src/api`: HTTP boundary, authentication, validation, error mapping, static PWA delivery.
- `src/web`: mobile-first PWA shell.

## Dependency direction

The domain does not import HTTP, SQLite, filesystem, OCR, AI, or retailer integrations. External effects depend on domain contracts. Provider lifecycle is explicit and disposable.

## Data integrity

SQLite enables WAL, foreign keys, busy timeout, explicit migrations, transactional receipt import, immutable price observations, and FTS5 product search. Money uses integer cents. Quantities and normalized prices use integer rational pairs.

## Resource model

There is no Redis, broker, database server, browser process, OCR daemon, polling loop, or unbounded queue. Heavy providers are loaded only for a request and disposed. Idle hibernation cleans temporary files and marks diagnostics.
