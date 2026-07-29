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

function readSchemaVersion(path: string): number {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const row = database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number };
    return Number(row.version);
  } finally {
    database.close();
  }
}

test('SQLite migrations, lists, FTS, receipt evidence and backup work together', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-db-'));
  const databasePath = join(root, 'basketra.db');
  const database = new BasketraDatabase(databasePath);
  try {
    const productId = database.seedProduct({ name: 'Leche entera 1 L', brand: 'Hacendado', aliases: ['leche casa'] });
    assert.equal(database.searchProducts('leche', 8)[0]?.id, productId);
    assert.deepEqual(database.searchProducts('', 8), []);

    const list = database.createShoppingList('Semanal');
    const item = database.addShoppingListItem({ listId: list.id, text: 'Leche', quantityMinor: 2, unit: 'unit', exactRequired: true, substitutionAllowed: false });
    assert.equal(database.listShoppingLists()[0]?.id, list.id);
    assert.deepEqual(database.getShoppingList(list.id)?.items[0], item);
    assert.equal(database.getShoppingList('missing'), undefined);
    assert.throws(() => database.addShoppingListItem({ listId: 'missing', text: 'X', quantityMinor: 1, unit: 'unit', exactRequired: false, substitutionAllowed: true }), /SHOPPING_LIST_NOT_FOUND/);

    const receiptInput = {
      importKey: 'receipt-key-0001',
      declaredTotalMinor: 120,
      originalText: 'Leche 1 120 120',
      provider: 'embedded-text+ai-verification',
      deterministic: { items: [{ description: 'LECHE', lineTotalMinor: 120 }] },
      ai: { items: [{ description: 'Leche', confidence: .8 }] },
      captures: [{ storageKey: 'a'.repeat(64) + '.png', contentHash: 'a'.repeat(64), mimeType: 'image/png', originalName: 'receipt.png' }],
      items: [{ description: 'Leche', quantity: 1, unitPriceMinor: 120, lineTotalMinor: 120, status: 'confirmed', confidence: 1 }],
      corrections: [{ itemIndex: 0, field: 'description', original: 'LECHE', corrected: 'Leche' }],
    } as const;
    const receiptId = database.importReceipt(receiptInput);
    assert.equal(database.importReceipt(receiptInput), receiptId);

    assert.throws(() => database.importReceipt({ ...receiptInput, importKey: 'constraint-rollback', items: [{ ...receiptInput.items[0], confidence: 2 }] }));
    assert.doesNotThrow(() => database.importReceipt({ ...receiptInput, importKey: 'constraint-rollback', corrections: [] }));
    assert.throws(() => database.importReceipt({ ...receiptInput, importKey: 'correction-rollback', corrections: [{ itemIndex: 3, field: 'description', original: 'x', corrected: 'y' }] }));
    assert.doesNotThrow(() => database.importReceipt({ ...receiptInput, importKey: 'correction-rollback', corrections: [] }));

    const backupPath = join(root, 'backups', 'test.db');
    const backup = database.backup(backupPath);
    assert.ok(backup.bytes > 0);
    assert.deepEqual(validateBackup(backupPath), { valid: true, version: CURRENT_SCHEMA_VERSION });
    const backupDatabase = new DatabaseSync(backupPath, { readOnly: true });
    try {
      assert.equal((backupDatabase.prepare('SELECT COUNT(*) AS count FROM receipt_captures').get() as { count: number }).count, 3);
      assert.equal((backupDatabase.prepare('SELECT COUNT(*) AS count FROM receipt_corrections').get() as { count: number }).count, 1);
      const extraction = backupDatabase.prepare('SELECT provider, ai_json AS aiJson FROM receipt_extractions WHERE receipt_id = ?').get(receiptId) as { provider: string; aiJson: string };
      assert.equal(extraction.provider, 'embedded-text+ai-verification');
      assert.match(extraction.aiJson, /confidence/);
    } finally {
      backupDatabase.close();
    }
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('startup upgrades a representative version-one database after validating a pre-migration backup', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-upgrade-'));
  const databasePath = join(root, 'basketra.db');
  const migrationBackupDir = join(root, 'migration-backups');
  createVersionOneFixture(databasePath);

  const database = new BasketraDatabase(databasePath, {
    migrationBackupDir,
    clock: () => new Date('2026-07-29T12:00:00.000Z'),
  });
  try {
    assert.equal(database.listShoppingLists()[0]?.name, 'Legacy list');
  } finally {
    database.close();
  }

  assert.equal(readSchemaVersion(databasePath), CURRENT_SCHEMA_VERSION);
  const backupNames = readdirSync(migrationBackupDir);
  assert.equal(backupNames.length, 1);
  assert.deepEqual(validateBackup(join(migrationBackupDir, backupNames[0]!)), { valid: true, version: 1 });

  const upgradedDatabase = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const audit = upgradedDatabase.prepare('SELECT from_version AS fromVersion, to_version AS toVersion, bytes FROM schema_migration_backups').get() as { fromVersion: number; toVersion: number; bytes: number };
    assert.deepEqual({ fromVersion: audit.fromVersion, toVersion: audit.toVersion }, { fromVersion: 1, toVersion: CURRENT_SCHEMA_VERSION });
    assert.ok(audit.bytes > 0);
  } finally {
    upgradedDatabase.close();
  }

  const reopened = new BasketraDatabase(databasePath, { migrationBackupDir });
  reopened.close();
  assert.equal(readdirSync(migrationBackupDir).length, 1);
  rmSync(root, { recursive: true, force: true });
});

test('a failing migration rolls back the complete pending batch and preserves its validated backup', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-migration-rollback-'));
  const databasePath = join(root, 'basketra.db');
  const migrationBackupDir = join(root, 'migration-backups');
  createVersionOneFixture(databasePath);

  assert.throws(() => new BasketraDatabase(databasePath, {
    migrationBackupDir,
    additionalMigrations: [{
      version: CURRENT_SCHEMA_VERSION + 1,
      kind: 'safe',
      sql: 'CREATE TABLE migration_partial(id INTEGER PRIMARY KEY); INSERT INTO missing_table(id) VALUES (1);',
    }],
  }), /missing_table/);

  assert.equal(readSchemaVersion(databasePath), 1);
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='schema_migration_backups'").get() as { count: number }).count, 0);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='migration_partial'").get() as { count: number }).count, 0);
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM shopping_lists WHERE id = ?').get('list_fixture') as { count: number }).count, 1);
  } finally {
    database.close();
  }

  const backupNames = readdirSync(migrationBackupDir);
  assert.equal(backupNames.length, 1);
  assert.deepEqual(validateBackup(join(migrationBackupDir, backupNames[0]!)), { valid: true, version: 1 });

  const recovered = new BasketraDatabase(databasePath, { migrationBackupDir });
  recovered.close();
  assert.equal(readSchemaVersion(databasePath), CURRENT_SCHEMA_VERSION);
  rmSync(root, { recursive: true, force: true });
});

test('destructive migrations require an explicit code-level authorization', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-destructive-migration-'));
  const databasePath = join(root, 'basketra.db');
  const database = new BasketraDatabase(databasePath);
  database.close();

  assert.throws(() => new BasketraDatabase(databasePath, {
    additionalMigrations: [{
      version: CURRENT_SCHEMA_VERSION + 1,
      kind: 'destructive',
      sql: 'DROP TABLE shopping_lists;',
    }],
  }), /requires explicit authorization/);

  assert.equal(readSchemaVersion(databasePath), CURRENT_SCHEMA_VERSION);
  const preserved = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal((preserved.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='shopping_lists'").get() as { count: number }).count, 1);
  } finally {
    preserved.close();
  }
  rmSync(root, { recursive: true, force: true });
});
