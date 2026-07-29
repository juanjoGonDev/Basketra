# Backup and restore

## Backup

The API checkpoints WAL, copies `basketra.db` into the mounted `backups/` directory, and returns only the logical backup name and size.

```bash
curl -X POST http://127.0.0.1:3000/api/v1/backup \
  -H "Authorization: Bearer $BASKETRA_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"basketra-2026-07-29.db"}'
```

## Validation

```bash
curl -X POST http://127.0.0.1:3000/api/v1/restore/validate \
  -H "Authorization: Bearer $BASKETRA_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"basketra-2026-07-29.db"}'
```

Validation runs SQLite integrity checking and confirms the migration version.

## Restore procedure

1. Stop Basketra.
2. Copy the current database and `files/` directory to a separate safe location.
3. Validate the candidate backup.
4. Replace `/data/basketra.db` while the process is stopped.
5. Start Basketra and verify `/readiness` and critical data.

The application intentionally does not perform destructive in-place restore through HTTP.
