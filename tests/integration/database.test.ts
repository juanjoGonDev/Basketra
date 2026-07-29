import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { BasketraDatabase, validateBackup } from '../../src/infrastructure/database.ts';

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
    assert.deepEqual(validateBackup(backupPath), { valid: true, version: 1 });
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
