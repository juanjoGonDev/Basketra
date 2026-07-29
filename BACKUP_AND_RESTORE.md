# Backup and restore

## Backup

The API checkpoints WAL, copies `basketra.db` into the mounted `backups/` directory, converts the copy to a standalone rollback-journal database, and returns only the logical backup name and size.

```bash
curl --request POST http://127.0.0.1:3000/api/v1/backup \
  --header "Authorization: Bearer $BASKETRA_AUTH_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-2026-07-29.db"}'
```

A named Docker volume is not an independent disaster-recovery copy. Export important backup files to separately managed storage.

## Validation

```bash
curl --request POST http://127.0.0.1:3000/api/v1/restore/validate \
  --header "Authorization: Bearer $BASKETRA_AUTH_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"name":"basketra-2026-07-29.db"}'
```

Validation runs SQLite integrity checking and confirms the migration version.

## Automatic pre-migration backup

When startup finds pending migrations, Basketra creates a validated backup under `/data/backups/migrations` before changing the schema. It records the source version, target version, backup name, byte size, and creation time after the migration transaction succeeds.

The complete pending migration batch commits atomically. On failure, the batch rolls back, the source database version remains unchanged, and the validated pre-migration backup remains available.

## Restore procedure

1. Validate the candidate backup through the API.
2. Stop Basketra.
3. Copy the current database and `files/` directory to a separate safe location.
4. Replace `/data/basketra.db` while the process is stopped.
5. Remove stale `basketra.db-wal` and `basketra.db-shm` files.
6. Start Basketra and verify `/readiness` plus critical data.

The application intentionally does not perform destructive in-place restore through HTTP. See [RASPBERRY_DEPLOYMENT.md](RASPBERRY_DEPLOYMENT.md) for exact Docker Compose commands, image rollback, and recovery steps.
