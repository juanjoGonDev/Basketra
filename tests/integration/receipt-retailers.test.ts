import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { BasketraDatabase, type ReceiptImportInput } from '../../src/infrastructure/database.ts';
import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

function receiptInput(importKey: string, retailerName?: string): ReceiptImportInput {
  return {
    importKey,
    declaredTotalMinor: 120,
    originalText: 'Leche 1 120 120',
    provider: 'local-tesseract',
    ...(retailerName ? { retailerName } : {}),
    deterministic: { items: [{ description: 'Leche', lineTotalMinor: 120 }] },
    items: [{
      description: 'Leche',
      quantity: 1,
      unitPriceMinor: 120,
      lineTotalMinor: 120,
      status: 'confirmed',
      confidence: 1,
    }],
  };
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

test('receipt retailers are reused case-insensitively and ranked from saved receipts', () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-retailers-'));
  const databasePath = join(root, 'basketra.db');
  const database = new BasketraDatabase(databasePath);
  try {
    database.importReceipt(receiptInput('retailer-receipt-0001', 'Mercadona'));
    database.importReceipt(receiptInput('retailer-receipt-0002', 'mercadona'));
    database.importReceipt(receiptInput('retailer-receipt-0003'));

    assert.deepEqual(database.searchRetailers('mer', 8).map(({ name, receiptCount }) => ({ name, receiptCount })), [
      { name: 'Mercadona', receiptCount: 2 },
    ]);
    assert.deepEqual(database.searchRetailers('%', 8), []);

    const readOnly = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal((readOnly.prepare('SELECT COUNT(*) AS count FROM retailers').get() as { count: number }).count, 1);
      assert.equal((readOnly.prepare('SELECT COUNT(*) AS count FROM receipts WHERE retailer_id IS NOT NULL').get() as { count: number }).count, 2);
      assert.equal((readOnly.prepare('SELECT COUNT(*) AS count FROM receipts WHERE retailer_id IS NULL').get() as { count: number }).count, 1);
    } finally {
      readOnly.close();
    }
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('HTTP confirmation persists an optional retailer and exposes bounded suggestions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-retailer-api-'));
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 0,
    dataDir: join(root, 'data'),
    tempDir: join(root, 'tmp'),
    maxBodyBytes: 16_384,
    aiTimeoutMs: 1_000,
    aiMaxRetries: 1,
    aiImageCapability: true,
    aiPdfCapability: false,
    idleHibernateAfterMs: 0,
    idleExitAfterMs: 0,
  };
  const server = new BasketraServer(config);
  await server.listen();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const confirmed = await fetch(`${baseUrl}/api/v1/receipts/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        importKey: 'retailer-api-receipt-0001',
        retailerName: 'Carrefour',
        originalText: 'Pan',
        declaredTotalMinor: 150,
        items: [{ description: 'Pan', quantity: 1, unitPriceMinor: 150, lineTotalMinor: 150 }],
      }),
    });
    assert.equal(confirmed.status, 201);

    const suggestionsResponse = await fetch(`${baseUrl}/api/v1/retailers/suggestions?q=ca&limit=3`);
    assert.equal(suggestionsResponse.status, 200);
    const suggestions = await json<{ suggestions: Array<{ id: string; name: string; receiptCount: number; lastUsedAt?: string }> }>(suggestionsResponse);
    assert.equal(suggestions.suggestions.length, 1);
    assert.match(suggestions.suggestions[0]?.id ?? '', /^retailer_/);
    assert.equal(suggestions.suggestions[0]?.name, 'Carrefour');
    assert.equal(suggestions.suggestions[0]?.receiptCount, 1);
    assert.match(suggestions.suggestions[0]?.lastUsedAt ?? '', /^\d{4}-/);

    assert.equal((await fetch(`${baseUrl}/api/v1/retailers/suggestions?q=c`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/v1/retailers/suggestions?q=ca&limit=0`)).status, 400);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
