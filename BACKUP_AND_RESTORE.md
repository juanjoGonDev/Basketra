# Backup and restore

## Storage budgets

Basketra bounds every persistent SQLite copy so repeated operations cannot consume the volume indefinitely:

| Storage | Default retention |
| --- | ---: |
| Primary SQLite database | 512 MiB maximum |
| SQLite page cache | 8 MiB maximum |
| SQLite WAL journal target | 16 MiB maximum |
| Automatic pre-migration backups | newest 3, at most 768 MiB combined |
| Manual API backups | newest 5, at most 768 MiB combined |
| Deduplicated receipt files | 512 MiB maximum |

The limits are enforced in application code, not only documented. A write or backup that cannot fit fails explicitly instead of silently expanding the volume. Retention considers both file count and total bytes, so increasing database size does not multiply disk use without a ceiling.

## Manual backup

The API checkpoints WAL, creates the backup through a uniquely named temporary file, converts it to a standalone rollback-journal database, atomically renames it into `backups/`, and then applies retention. Interrupted or failed backups leave no `.tmp` or `.upload` residue.

```bash
curl --request POST http://127.0.0.1:3000/api/v1/backup \
  --header "Authorization: Bearer $BASKETRA_AUTH_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-2026-07-29.db"}'
```

A named Docker volume is not an independent disaster-recovery copy. Export important backup files to separately managed storage before local retention removes older copies.

## Validation

```bash
curl --request POST http://127.0.0.1:3000/api/v1/restore/validate \
  --header "Authorization: Bearer $BASKETRA_AUTH_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-2026-07-29.db"}'
```

Validation runs SQLite integrity checking and confirms the migration version.

## Automatic pre-migration backup

When startup finds pending migrations, Basketra:

1. checkpoints and truncates SQLite WAL state;
2. reserves room under the migration-backup count and byte budgets;
3. creates a standalone backup under `/data/backups/migrations` through an atomic temporary file;
4. validates backup integrity and source schema version;
5. applies the complete pending migration batch in one transaction;
6. validates database integrity and the target version before commit;
7. prunes superseded backup files and matching audit rows.

On migration failure, the transaction rolls back, the source version remains unchanged, and the validated backup is retained. Repeated failed starts still retain only the configured newest copies.

## Restore procedure

1. Validate the candidate backup through the API.
2. Stop Basketra.
3. Copy the current database and `files/` directory to separately managed storage.
4. Replace `/data/basketra.db` while the process is stopped.
5. Remove stale `basketra.db-wal` and `basketra.db-shm` files.
6. Start Basketra and verify `/readiness` plus critical data.

The application intentionally does not perform destructive in-place restore through HTTP. See [RASPBERRY_DEPLOYMENT.md](RASPBERRY_DEPLOYMENT.md) for exact Docker Compose commands, immutable image rollback, and recovery steps.
