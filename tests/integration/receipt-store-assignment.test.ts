import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';
import { FileStore } from '../../src/infrastructure/files.ts';
import { ReceiptExtractionService } from '../../src/receipts/service.ts';

function receipt(importKey: string, retailerName: string, storeName?: string, storeId?: string) {
  return {
    importKey,
    declaredTotalMinor: 120,
    originalText: 'LECHE 1,20',
    provider: 'test',
    retailerName,
    ...(storeName ? { storeName } : {}),
    ...(storeId ? { storeId } : {}),
    deterministic: { items: [] },
    items: [{
      description: 'LECHE', quantity: 1, unitPriceMinor: 120, lineTotalMinor: 120,
      status: 'confirmed', confidence: 1,
    }],
  } as const;
}

test('receipt confirmation reuses or creates an evidenced store and projects only new prices with it', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-store-'));
  const path = join(root, 'basketra.db');
  const database = new BasketraDatabase(path);
  try {
    const existing = database.saveStore({ retailerName: 'Mercadona', name: 'Centro' });
    const firstId = database.importReceipt(receipt('receipt-store-0001', 'Mercadona', 'Centro', existing.id));
    const secondId = database.importReceipt(receipt('receipt-store-0002', 'Mercadona', 'Norte'));
    const thirdId = database.importReceipt(receipt('receipt-store-0003', 'Mercadona', 'Norte'));
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      const receipts = raw.prepare('SELECT id, store_id AS storeId FROM receipts ORDER BY import_key').all() as Array<{ id: string; storeId: string | null }>;
      const stores = raw.prepare("SELECT id, name FROM stores WHERE name = 'Norte' COLLATE NOCASE").all() as Array<{ id: string; name: string }>;
      const observations = raw.prepare(`
        SELECT price_observations.store_id AS storeId
        FROM price_observations
        JOIN receipt_items ON price_observations.id = 'price_receipt_' || receipt_items.id
        JOIN receipts ON receipts.id = receipt_items.receipt_id
        WHERE receipt_items.receipt_id IN (?, ?, ?)
        ORDER BY receipts.import_key
      `).all(firstId, secondId, thirdId) as Array<{ storeId: string | null }>;
      assert.equal(receipts.length, 3);
      assert.equal(receipts[0]?.storeId, existing.id);
      assert.equal(stores.length, 1);
      assert.ok(stores[0]?.id);
      assert.equal(receipts[1]?.storeId, stores[0]?.id);
      assert.equal(receipts[2]?.storeId, stores[0]?.id);
      assert.deepEqual(observations.map((row) => row.storeId), [existing.id, stores[0]?.id, stores[0]?.id]);
    } finally {
      raw.close();
    }
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('receipt confirmation rejects an existing store from another retailer without writing a receipt', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-store-mismatch-'));
  const path = join(root, 'basketra.db');
  const database = new BasketraDatabase(path);
  try {
    const store = database.saveStore({ retailerName: 'Mercadona', name: 'Centro' });
    assert.throws(
      () => database.importReceipt(receipt('receipt-store-0004', 'Alcampo', undefined, store.id)),
      /RECEIPT_STORE_RETAILER_MISMATCH/,
    );
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal((raw.prepare('SELECT COUNT(*) AS count FROM receipts').get() as { count: number }).count, 0);
    } finally {
      raw.close();
    }
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('AI receipt jobs persist the compact store snapshot used by direct and durable analysis', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-store-snapshot-'));
  const path = join(root, 'basketra.db');
  const database = new BasketraDatabase(path);
  const fileStore = new FileStore(join(root, 'files'), join(root, 'tmp'), 1024 * 1024);
  const service = new ReceiptExtractionService(fileStore, () => ({
    async getCapabilities() { return { structuredOutput: true, jsonObject: true, image: true, pdf: true, internetSearch: false }; },
    async testConnection() { return { ok: true }; },
    async executeStructured() { throw new Error('NOT_USED'); },
    dispose() {},
  }), 0);
  try {
    const store = database.saveStore({ retailerName: 'Mercadona', name: 'Centro' });
    service.configureCategoryDatabase(path);
    const request = service.parseRequest({
      captures: [{ storageKey: `${'a'.repeat(64)}.png` }],
      verifyWithAi: true,
    });
    assert.deepEqual(request.storeInventory?.map((entry) => ({ ...entry })), [{
      id: store.id, name: 'Centro', retailerId: store.retailerId, retailerName: 'Mercadona',
    }]);
    const job = database.createReceiptExtractionJob(request);
    assert.deepEqual(
      (job.input as typeof request).storeInventory?.map((entry) => ({ ...entry })),
      request.storeInventory?.map((entry) => ({ ...entry })),
    );
  } finally {
    service.dispose();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
