# Backup and restore

## Access boundary

Basketra has no internal application token. Backup, download, import, and staged-restore endpoints must be used only through the trusted private network path: host loopback, VPN, SSH tunnel, reviewed LAN-only access, or an authenticated private reverse proxy. Anyone who can reach the service can invoke these administrative operations.

## Storage budgets

Basketra bounds persistent SQLite copies so repeated operations cannot consume the volume indefinitely:

| Storage | Default retention |
| --- | ---: |
| Primary SQLite database | 512 MiB maximum |
| SQLite page cache | 8 MiB maximum |
| SQLite WAL journal target | 16 MiB maximum |
| Automatic pre-migration backups | newest 3, at most 768 MiB combined |
| Manual and pre-restore backups | newest 5, at most 768 MiB combined |
| Deduplicated receipt files | 512 MiB maximum |

The limits are enforced in application code. A write or backup that cannot fit fails explicitly. Retention considers both file count and total bytes. Database imports stream directly to a staging file, keep memory usage bounded, and reject input above the 512 MiB primary-database ceiling. Full-volume or larger disaster-recovery operations remain offline procedures.

## Create and optionally download a backup

Settings separates creation from download. Creating a backup does not force a browser download; after the portable copy succeeds, the operator receives a specific download action.

The API checkpoints WAL, creates the backup through a uniquely named temporary file, converts it to a standalone rollback-journal database, atomically renames it into `backups/`, and applies retention. Interrupted or failed backups leave no `.tmp` or `.upload` residue.

```bash
curl --fail --request POST http://127.0.0.1:3000/api/v1/backup \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-2026-07-31.db"}'

curl --fail --output basketra-2026-07-31.db \
  http://127.0.0.1:3000/api/v1/backups/basketra-2026-07-31.db
```

The download route uses a fixed backup directory, strict filename validation, attachment headers, `Cache-Control: private, no-store`, and streaming. A named Docker volume is not an independent disaster-recovery copy. Export important files to separately managed storage before local retention removes older copies.

## Import and validate a backup

The Settings import control accepts `.db` files. Import never overwrites the active database. Basketra:

1. streams the upload directly into a uniquely named staging file with owner-only permissions;
2. enforces the 512 MiB database limit while reading and removes a partial file on failure;
3. accepts only the SQLite binary content types used by the application;
4. computes SHA-256 incrementally without buffering the complete database;
5. runs SQLite integrity checking;
6. verifies that the schema version is supported and not newer than the running application;
7. atomically moves the validated file into `/data/backups/imports`.

Invalid, empty, oversized, malformed, corrupt, schema-zero, or future-schema files are rejected and removed. Receipt content, original filenames, database bytes, and filesystem paths are not written to application logs.

The older server-side validation endpoint remains available for backups that already exist under `/data/backups`:

```bash
curl --fail --request POST http://127.0.0.1:3000/api/v1/restore/validate \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-2026-07-31.db"}'
```

## Staged restore from Settings

Restore is destructive and requires the exact confirmation phrase displayed by the UI. A successful request does not replace the active database while SQLite is open. Instead, Basketra:

1. creates and validates a portable `basketra-pre-restore-*.db` backup of the active database;
2. revalidates the selected imported copy and its digest;
3. writes an atomic pending-restore marker containing only generated names, digest, schema metadata, and timestamp;
4. responds to the browser;
5. exits cleanly;
6. validates the candidate, digest, and pre-restore backup again during the next startup, before opening the primary database;
7. copies and validates a temporary replacement;
8. removes stale WAL/SHM files and atomically renames the replacement to `/data/basketra.db`;
9. starts normally and resumes the private-route heartbeat.

A failed startup restore preserves the existing database. The pending marker is renamed to a failed marker so `restart: unless-stopped` cannot enter a destructive retry loop. Inspect application and container logs, preserve the pre-restore backup, and resolve the cause before trying again.

The receipt evidence files directory is not replaced by a database-only restore. A complete disaster-recovery plan must preserve `/data/files` together with compatible database backups.

## Automatic pre-migration backup

When startup finds pending migrations, Basketra:

1. checkpoints and truncates SQLite WAL state;
2. reserves room under the migration-backup count and byte budgets;
3. creates a standalone backup under `/data/backups/migrations` through an atomic temporary file;
4. validates backup integrity and source schema version;
5. applies the complete pending migration batch in one transaction;
6. validates database integrity and the target version before commit;
7. prunes superseded backup files and matching audit rows.

Schema migration 3 adds shopping-list completion state and completion timestamps. Existing list items remain pending.

On migration failure, the transaction rolls back, the source version remains unchanged, and the validated backup is retained. Repeated failed starts still retain only the configured newest copies.

## Offline restore procedure

Use the offline procedure for full-volume recovery, very large databases, or when the application cannot start:

1. Validate the candidate backup where possible.
2. Stop Basketra.
3. Copy the current database and `files/` directory to separately managed storage.
4. Replace `/data/basketra.db` while the process is stopped.
5. Remove stale `basketra.db-wal` and `basketra.db-shm` files.
6. Start Basketra and verify `/readiness`, `/api/v1/runtime`, lists, receipts, and stored evidence.

See [RASPBERRY_DEPLOYMENT.md](RASPBERRY_DEPLOYMENT.md) for exact Docker Compose commands, immutable image rollback, application logs, and recovery steps.
