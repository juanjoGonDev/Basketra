import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { BasketraDatabase, CURRENT_SCHEMA_VERSION, validateBackup } from '../../src/infrastructure/database.ts';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/schema-v1.sql');

function createVersionOneFixture(path: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec(Buffer.from(readFileSync(fixturePath)).toString('utf8'));
  } finally {
    database.close();
  }
}

test('SQLite page cache, WAL and maximum database size are bounded', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-storage-policy-'));
  const database = new BasketraDatabase(join(root, 'basketra.db'), {
    maxDatabaseBytes: 4 * 1024 * 1024,
    maxSqliteCacheBytes: 256 * 1024,
    maxWalBytes: 128 * 1024,
  });
  try {
    const limits = database.storageLimits();
    assert.ok(limits.maxDatabaseBytes <= 4 * 1024 * 1024);
    assert.equal(limits.cacheBytes, 256 * 1024);
    assert.equal(limits.walBytes, 128 * 1024);
    assert.ok(limits.maxPageCount > 0);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('manual backups are retained by count without leaving partial files', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-manual-retention-'));
  const backupDir = join(root, 'backups');
  const database = new BasketraDatabase(join(root, 'basketra.db'), {
    manualBackupRetention: { maxCount: 2, maxBytes: 4 * 1024 * 1024 },
  });
  try {
    database.backup(join(backupDir, 'backup-a.db'));
    database.backup(join(backupDir, 'backup-b.db'));
    database.backup(join(backupDir, 'backup-c.db'));
    const names = readdirSync(backupDir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
    assert.deepEqual(names, ['backup-b.db', 'backup-c.db']);
    for (const name of names) {
      assert.deepEqual(validateBackup(join(backupDir, name)), { valid: true, version: CURRENT_SCHEMA_VERSION });
    }
    assert.equal(names.some((name) => name.includes('.tmp')), false);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('repeated failed migrations keep only the configured number of validated backups', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-migration-retention-'));
  const databasePath = join(root, 'basketra.db');
  const migrationBackupDir = join(root, 'migration-backups');
  createVersionOneFixture(databasePath);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.throws(() => new BasketraDatabase(databasePath, {
      migrationBackupDir,
      migrationBackupRetention: { maxCount: 2, maxBytes: 4 * 1024 * 1024 },
      additionalMigrations: [{
        version: CURRENT_SCHEMA_VERSION + 1,
        kind: 'safe',
        sql: 'CREATE TABLE migration_partial(id INTEGER PRIMARY KEY); INSERT INTO missing_table(id) VALUES (1);',
      }],
    }), /missing_table/);
  }

  const names = readdirSync(migrationBackupDir);
  assert.equal(names.length, 2);
  assert.equal(names.some((name) => name.includes('.tmp')), false);
  for (const name of names) {
    assert.deepEqual(validateBackup(join(migrationBackupDir, name)), { valid: true, version: 1 });
  }
  rmSync(root, { recursive: true, force: true });
});

test('a backup budget smaller than the database fails before creating residue', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-backup-budget-'));
  const databasePath = join(root, 'basketra.db');
  const backupDir = join(root, 'backups');
  const database = new BasketraDatabase(databasePath, {
    manualBackupRetention: { maxCount: 1, maxBytes: 1 },
  });
  try {
    assert.throws(() => database.backup(join(backupDir, 'too-small.db')), /cannot fit/);
    assert.deepEqual(readdirSync(backupDir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name), []);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
