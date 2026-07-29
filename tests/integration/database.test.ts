import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BasketraDatabase, validateBackup } from '../../src/infrastructure/database.ts';

test('SQLite migrations, lists, FTS, receipt idempotency and backup work together', () => {
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
      items: [{ description: 'Leche', quantity: 1, unitPriceMinor: 120, lineTotalMinor: 120, status: 'confirmed', confidence: 1 }],
    } as const;
    const receiptId = database.importReceipt(receiptInput);
    assert.equal(database.importReceipt(receiptInput), receiptId);

    assert.throws(() => database.importReceipt({ ...receiptInput, importKey: 'rollback-key', items: [{ ...receiptInput.items[0], confidence: 2 }] }));
    assert.doesNotThrow(() => database.importReceipt({ ...receiptInput, importKey: 'rollback-key' }));

    const backupPath = join(root, 'backups', 'test.db');
    const backup = database.backup(backupPath);
    assert.ok(backup.bytes > 0);
    assert.deepEqual(validateBackup(backupPath), { valid: true, version: 1 });
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
