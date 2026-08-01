# Privacy

Basketra is designed for a single private installation. Receipt captures, extracted text, corrections, product mappings, shopping lists, price history, application logs, and backup files remain on the mounted local filesystem and SQLite database unless the operator explicitly configures an external AI or offer provider or downloads a backup.

The service worker caches only the application shell. It excludes every `/api/` request, including stored image previews, diagnostics, logs, and backup operations, so receipt content and private API responses are not persisted in the service-worker cache. Image previews use same-origin generated storage keys and `Cache-Control: private, no-store`.

The browser stores only interface state required to resume work: active list identifier, unsubmitted list-item draft, capture metadata, and optional AI mode. It does not store an application access token, provider credential, backup database, or application log history. A selected backup file is sent directly to the server by streaming and is not converted to Base64 or persisted in browser storage.

## Application logs

Basketra stores a bounded operational event stream under `/data/logs`. Server and browser events may contain timestamp, source, level, stable event, request ID, method, path without query, HTTP status, duration, and stable error code.

The ingestion contract excludes receipt text, product names, uploaded filenames, request/query content, headers, credentials, provider responses, arbitrary client messages, database bytes, and filesystem paths. Browser events are treated as untrusted and are sanitized, size-limited, batch-limited, and rate-limited before persistence. Rotation removes the oldest local archives first.

Docker process logs are separate from the application stream. They may contain startup, shutdown, native-process, or restore-failure metadata and must remain within the private operational boundary.

## Backups and restore

A manual backup contains the private SQLite dataset and must be treated as sensitive. Creating one does not automatically download it. Download requires a separate operator action and uses no-store attachment responses.

Imported databases are streamed to an owner-only staging directory, assigned generated names, hashed, and validated. Original client filenames are not written to application logs. A staged restore keeps a validated pre-restore database copy. Database restore does not automatically replace `/data/files`, so a complete recovery set may include both private database and receipt evidence files.

Exported backups and evidence copies are outside Basketra's local retention controls. Store them encrypted or on appropriately protected media and delete obsolete copies according to the operator's policy.

## External providers

External AI calls may disclose submitted operation content to the configured provider. When receipt verification is enabled, Basketra sends the original validated JPEG, PNG, or PDF capture together with the OCR text for that same page. It does not silently downgrade to text-only verification: a provider without the required image or PDF capability causes an explicit recoverable page error.

Use a provider you trust, prefer local or VPN endpoints, and review its retention policy. A provider running on the Raspberry host should be reached from Docker through the private host gateway, not exposed publicly. Basketra does not log complete receipt content, original attachment bytes, or AI responses.

The Settings page may display the provider URL, model, capabilities, and last four masked credential characters. It never returns the full credential or process environment.

## Original evidence

Original capture retention is persistent. Removing a capture from a draft does not delete the underlying evidence because it may be deduplicated or referenced by a confirmed receipt. A future garbage-collection policy must prove that a file is unreferenced before deletion.

Network reachability is authorization in the supported deployment. Restrict access using loopback, VPN, firewall, SSH tunnelling, or an authenticated private reverse proxy.
