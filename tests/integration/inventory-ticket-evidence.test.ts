import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

type JsonObject = Record<string, unknown>;
type JsonRequestInit = Readonly<{ method?: string; body?: unknown }>;

function record(value: unknown): JsonObject {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as JsonObject;
}

function array(value: unknown): readonly unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

function string(value: unknown): string {
  assert.equal(typeof value, 'string');
  return value;
}

function config(root: string): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir: join(root, 'data'),
    tempDir: join(root, 'tmp'),
    maxBodyBytes: 1024 * 1024,
    aiMaxRetries: 0,
    aiImageCapability: true,
    aiPdfCapability: false,
    overpassBaseUrl: 'http://127.0.0.1:9/api/',
    idleHibernateAfterMs: 0,
    idleExitAfterMs: 0,
  };
}

async function request(baseUrl: string, path: string, init: JsonRequestInit = {}): Promise<Readonly<{ status: number; body?: JsonObject }>> {
  const serialized = init.body === undefined ? undefined : JSON.stringify(init.body);
  return await new Promise((resolvePromise, reject) => {
    const req = httpRequest(new URL(path, baseUrl), {
      method: init.method ?? 'GET',
      agent: false,
      headers: serialized === undefined ? undefined : {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(serialized),
      },
    }, (response: IncomingMessage) => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.once('error', reject);
      response.once('end', () => {
        try {
          const status = response.statusCode ?? 0;
          const raw = Buffer.concat(chunks).toString('utf8');
          resolvePromise(raw ? { status, body: record(JSON.parse(raw) as unknown) } : { status });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.once('error', reject);
    req.end(serialized);
  });
}

function queryOne<T>(databasePath: string, sql: string, ...params: Array<string | number>): T {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare(sql).get(...params) as T;
  } finally {
    database.close();
  }
}

test('historical ticket edits preserve immutable receipt and price evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-inventory-ticket-evidence-'));
  const server = new BasketraServer(config(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;
  const databasePath = join(root, 'data', 'basketra.db');

  try {
    const imported = await request(baseUrl, '/api/v1/receipts/confirm', {
      method: 'POST',
      body: {
        importKey: 'history-evidence-001',
        declaredTotalMinor: 100,
        originalText: 'Leche entera 1 L 1,00',
        retailerName: 'Mercadona',
        items: [{
          description: 'Leche entera 1 L',
          quantity: 1,
          unitPriceMinor: 100,
          lineTotalMinor: 100,
        }],
      },
    });
    assert.equal(imported.status, 201);
    const receiptId = string(imported.body?.['receiptId']);

    const detail = await request(baseUrl, `/api/v1/inventory/tickets/${encodeURIComponent(receiptId)}`);
    assert.equal(detail.status, 200);
    const ticket = record(detail.body?.['ticket']);
    const line = record(array(ticket['items'])[0]);
    const itemId = string(line['id']);

    const initialObservation = queryOne<{ priceMinor: number }>(databasePath, `
      SELECT price_observations.price_minor AS priceMinor
      FROM price_observations
      JOIN external_evidence ON external_evidence.id = price_observations.evidence_id
      WHERE external_evidence.source_type = 'receipt'
        AND external_evidence.source_reference = ?
    `, `receipt-item:${itemId}`);
    assert.equal(Number(initialObservation.priceMinor), 100);

    const edited = await request(baseUrl, `/api/v1/inventory/tickets/${encodeURIComponent(receiptId)}`, {
      method: 'PATCH',
      body: {
        purchasedAt: ticket['purchasedAt'],
        paymentStatus: 'paid',
        taxMinor: 0,
        receiptDiscountMinor: 0,
        items: [{
          id: itemId,
          description: 'Leche entera 1 L corregida',
          quantity: 1,
          unit: 'unit',
          unitPriceMinor: 250,
        }],
      },
    });
    assert.equal(edited.status, 200);
    assert.equal(record(edited.body?.['ticket'])['declaredTotalMinor'], 250);

    const preservedObservation = queryOne<{ priceMinor: number }>(databasePath, `
      SELECT price_observations.price_minor AS priceMinor
      FROM price_observations
      JOIN external_evidence ON external_evidence.id = price_observations.evidence_id
      WHERE external_evidence.source_type = 'receipt'
        AND external_evidence.source_reference = ?
    `, `receipt-item:${itemId}`);
    assert.equal(Number(preservedObservation.priceMinor), 100);

    const correctionCount = queryOne<{ count: number }>(databasePath, `
      SELECT COUNT(*) AS count FROM receipt_corrections WHERE receipt_item_id = ?
    `, itemId);
    assert.ok(Number(correctionCount.count) >= 2);

    const removed = await request(baseUrl, `/api/v1/inventory/tickets/${encodeURIComponent(receiptId)}`, {
      method: 'PATCH',
      body: {
        purchasedAt: ticket['purchasedAt'],
        paymentStatus: 'paid',
        taxMinor: 0,
        receiptDiscountMinor: 0,
        items: [],
      },
    });
    assert.equal(removed.status, 200);
    const removedTicket = record(removed.body?.['ticket']);
    assert.equal(removedTicket['declaredTotalMinor'], 0);
    assert.equal(array(removedTicket['items']).length, 0);

    const tombstoned = queryOne<{ status: string; originalDescription: string }>(databasePath, `
      SELECT status, original_description AS originalDescription FROM receipt_items WHERE id = ?
    `, itemId);
    assert.equal(tombstoned.status, 'deleted');
    assert.equal(tombstoned.originalDescription, 'Leche entera 1 L');

    const productVariantId = string(queryOne<{ productVariantId: string }>(databasePath, `
      SELECT product_variant_id AS productVariantId FROM receipt_items WHERE id = ?
    `, itemId).productVariantId);

    const impactResponse = await request(baseUrl, `/api/v1/inventory/tickets/${encodeURIComponent(receiptId)}/delete-impact`);
    assert.equal(impactResponse.status, 200);
    const impact = record(impactResponse.body?.['impact']);
    assert.equal(impact['canDelete'], true);
    assert.ok(Number(impact['externalEvidence']) >= 1);
    assert.ok(Number(impact['retainedPriceObservations']) >= 1);
    assert.ok(Number(impact['corrections']) >= 1);
    assert.match(string(impact['warning']), /se eliminarán/i);

    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TRIGGER test_receipt_delete_rollback
      BEFORE DELETE ON receipts
      WHEN OLD.id = '${receiptId.replaceAll("'", "''")}'
      BEGIN
        SELECT RAISE(ABORT, 'forced receipt delete rollback');
      END;
    `);
    database.close();

    const failedDelete = await request(baseUrl, `/api/v1/inventory/tickets/${encodeURIComponent(receiptId)}`, { method: 'DELETE' });
    assert.equal(failedDelete.status, 500);
    assert.ok(Number(queryOne<{ count: number }>(databasePath, `
      SELECT COUNT(*) AS count FROM external_evidence
      WHERE source_type = 'receipt' AND source_reference = ?
    `, `receipt-item:${itemId}`).count) >= 1);
    assert.ok(Number(queryOne<{ count: number }>(databasePath, `
      SELECT COUNT(*) AS count FROM price_observations
      WHERE evidence_id IN (
        SELECT id FROM external_evidence
        WHERE source_type = 'receipt' AND source_reference = ?
      )
    `, `receipt-item:${itemId}`).count) >= 1);

    const writable = new DatabaseSync(databasePath);
    writable.exec('DROP TRIGGER test_receipt_delete_rollback');
    writable.close();

    const deleted = await request(baseUrl, `/api/v1/inventory/tickets/${encodeURIComponent(receiptId)}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);

    const missing = await request(baseUrl, `/api/v1/inventory/tickets/${encodeURIComponent(receiptId)}`);
    assert.equal(missing.status, 404);
    assert.equal(Number(queryOne<{ count: number }>(databasePath, 'SELECT COUNT(*) AS count FROM receipt_items WHERE receipt_id = ?', receiptId).count), 0);
    assert.equal(Number(queryOne<{ count: number }>(databasePath, 'SELECT COUNT(*) AS count FROM receipt_captures WHERE receipt_id = ?', receiptId).count), 0);
    assert.equal(Number(queryOne<{ count: number }>(databasePath, 'SELECT COUNT(*) AS count FROM receipt_extractions WHERE receipt_id = ?', receiptId).count), 0);
    assert.equal(Number(queryOne<{ count: number }>(databasePath, `
      SELECT COUNT(*) AS count FROM external_evidence
      WHERE source_type = 'receipt' AND source_reference = ?
    `, `receipt-item:${itemId}`).count), 0);
    assert.equal(Number(queryOne<{ count: number }>(databasePath, `
      SELECT COUNT(*) AS count FROM price_observations WHERE id = ?
    `, `price_receipt_${itemId}`).count), 0);
    assert.equal(Number(queryOne<{ count: number }>(databasePath, `
      SELECT COUNT(*) AS count FROM product_variants WHERE id = ?
    `, productVariantId).count), 1);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
