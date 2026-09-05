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

async function createStore(baseUrl: string, retailerName: string, name: string): Promise<JsonObject> {
  const response = await request(baseUrl, '/api/v1/inventory/stores', {
    method: 'POST',
    body: { retailerName, name },
  });
  assert.equal(response.status, 201);
  return record(response.body?.['store']);
}

function ticketPatchBody(ticket: JsonObject, storeId: string | null): JsonObject {
  return {
    storeId,
    purchasedAt: ticket['purchasedAt'],
    paymentStatus: ticket['paymentStatus'],
    taxMinor: ticket['taxMinor'],
    receiptDiscountMinor: ticket['receiptDiscountMinor'],
    items: array(ticket['items']).map(value => {
      const item = record(value);
      return {
        id: item['id'],
        description: item['description'],
        quantity: item['quantity'],
        unit: item['unit'],
        unitPriceMinor: item['unitPriceMinor'],
      };
    }),
  };
}

async function importReceipt(baseUrl: string, storeId: string, importKey: string): Promise<string> {
  const response = await request(baseUrl, '/api/v1/receipts/confirm', {
    method: 'POST',
    body: {
      importKey,
      declaredTotalMinor: 120,
      originalText: 'LECHE 1,20',
      retailerName: 'ALCAMPO',
      storeId,
      items: [{
        description: 'LECHE',
        quantity: 1,
        unitPriceMinor: 120,
        lineTotalMinor: 120,
      }],
    },
  });
  assert.equal(response.status, 201);
  return string(response.body?.['receiptId']);
}

test('ticket Store reassignment moves only receipt-item-evidenced observations in the same edit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-ticket-store-reassign-'));
  const server = new BasketraServer(config(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;
  const databasePath = join(root, 'data', 'basketra.db');

  try {
    const firstStore = await createStore(baseUrl, 'ALCAMPO', 'ALCAMPO ALMERIA');
    const secondStore = await createStore(baseUrl, 'ALCAMPO', 'ALCAMPO CENTRO');
    const receiptId = await importReceipt(baseUrl, string(firstStore['id']), 'ticket-store-reassign-0001');

    const database = new DatabaseSync(databasePath, { readOnly: true });
    const item = database.prepare(`
      SELECT id, product_variant_id AS productVariantId
      FROM receipt_items WHERE receipt_id = ?
    `).get(receiptId) as { id: string; productVariantId: string };
    database.close();
    assert.ok(item.productVariantId);

    const manualPrice = await request(baseUrl, `/api/v1/products/${encodeURIComponent(item.productVariantId)}/prices`, {
      method: 'POST',
      body: {
        retailerName: 'ALCAMPO',
        storeId: firstStore['id'],
        priceMinor: 130,
      },
    });
    assert.equal(manualPrice.status, 201);
    const manualObservationId = string(record(manualPrice.body?.['observation'])['id']);

    const detail = await request(baseUrl, `/api/v1/inventory/tickets/${encodeURIComponent(receiptId)}`);
    assert.equal(detail.status, 200);
    const ticket = record(detail.body?.['ticket']);

    const edited = await request(baseUrl, `/api/v1/inventory/tickets/${encodeURIComponent(receiptId)}`, {
      method: 'PATCH',
      body: ticketPatchBody(ticket, string(secondStore['id'])),
    });
    assert.equal(edited.status, 200);
    assert.equal(record(edited.body?.['ticket'])['storeId'], secondStore['id']);

    const raw = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const receiptObservation = raw.prepare(`
        SELECT price_observations.store_id AS storeId
        FROM price_observations
        JOIN external_evidence ON external_evidence.id = price_observations.evidence_id
        WHERE external_evidence.source_type = 'receipt'
          AND external_evidence.source_reference = ?
      `).get(`receipt-item:${item.id}`) as { storeId: string | null };
      assert.equal(receiptObservation.storeId, secondStore['id']);

      const manualObservation = raw.prepare(`
        SELECT store_id AS storeId FROM price_observations WHERE id = ?
      `).get(manualObservationId) as { storeId: string | null };
      assert.equal(manualObservation.storeId, firstStore['id']);
    } finally {
      raw.close();
    }
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('ticket Store edit rejects a Store owned by another retailer without partial mutation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-ticket-store-mismatch-'));
  const server = new BasketraServer(config(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;
  const databasePath = join(root, 'data', 'basketra.db');

  try {
    const firstStore = await createStore(baseUrl, 'ALCAMPO', 'ALCAMPO ALMERIA');
    const incompatibleStore = await createStore(baseUrl, 'Mercadona', 'Mercadona Centro');
    const receiptId = await importReceipt(baseUrl, string(firstStore['id']), 'ticket-store-mismatch-0001');

    const detail = await request(baseUrl, `/api/v1/inventory/tickets/${encodeURIComponent(receiptId)}`);
    const ticket = record(detail.body?.['ticket']);

    const before = new DatabaseSync(databasePath, { readOnly: true });
    const itemId = string((before.prepare('SELECT id FROM receipt_items WHERE receipt_id = ?').get(receiptId) as { id: string }).id);
    const beforeObservation = before.prepare(`
      SELECT price_observations.store_id AS storeId
      FROM price_observations
      JOIN external_evidence ON external_evidence.id = price_observations.evidence_id
      WHERE external_evidence.source_type = 'receipt'
        AND external_evidence.source_reference = ?
    `).get(`receipt-item:${itemId}`) as { storeId: string | null };
    before.close();

    const edited = await request(baseUrl, `/api/v1/inventory/tickets/${encodeURIComponent(receiptId)}`, {
      method: 'PATCH',
      body: ticketPatchBody(ticket, string(incompatibleStore['id'])),
    });
    assert.equal(edited.status, 400);
    assert.equal(record(edited.body?.['error'])['code'], 'VALIDATION_ERROR');

    const raw = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const receipt = raw.prepare('SELECT retailer_id AS retailerId, store_id AS storeId FROM receipts WHERE id = ?')
        .get(receiptId) as { retailerId: string; storeId: string | null };
      assert.equal(receipt.storeId, firstStore['id']);
      assert.equal(receipt.retailerId, firstStore['retailerId']);

      const observation = raw.prepare(`
        SELECT price_observations.store_id AS storeId
        FROM price_observations
        JOIN external_evidence ON external_evidence.id = price_observations.evidence_id
        WHERE external_evidence.source_type = 'receipt'
          AND external_evidence.source_reference = ?
      `).get(`receipt-item:${itemId}`) as { storeId: string | null };
      assert.equal(observation.storeId, beforeObservation.storeId);
    } finally {
      raw.close();
    }
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('receipt confirmation without Store uses the validation error contract and writes nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-confirm-store-required-'));
  const server = new BasketraServer(config(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;
  const databasePath = join(root, 'data', 'basketra.db');

  try {
    const response = await request(baseUrl, '/api/v1/receipts/confirm', {
      method: 'POST',
      body: {
        importKey: 'confirm-store-required-0001',
        declaredTotalMinor: 120,
        originalText: 'LECHE 1,20',
        retailerName: 'ALCAMPO',
        items: [{
          description: 'LECHE',
          quantity: 1,
          unitPriceMinor: 120,
          lineTotalMinor: 120,
        }],
      },
    });
    assert.equal(response.status, 400);
    assert.equal(record(response.body?.['error'])['code'], 'VALIDATION_ERROR');

    const raw = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const counts = raw.prepare(`
        SELECT
          (SELECT COUNT(*) FROM receipts) AS receipts,
          (SELECT COUNT(*) FROM receipt_items) AS items,
          (SELECT COUNT(*) FROM price_observations) AS observations
      `).get() as { receipts: number; items: number; observations: number };
      assert.deepEqual({ ...counts }, { receipts: 0, items: 0, observations: 0 });
    } finally {
      raw.close();
    }
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('ticket editor cannot clear the Store of a confirmed receipt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-ticket-store-required-'));
  const server = new BasketraServer(config(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const store = await createStore(baseUrl, 'ALCAMPO', 'ALCAMPO ALMERIA');
    const receiptId = await importReceipt(baseUrl, string(store['id']), 'ticket-store-required-0001');
    const detail = await request(baseUrl, `/api/v1/inventory/tickets/${encodeURIComponent(receiptId)}`);
    const ticket = record(detail.body?.['ticket']);

    const edited = await request(baseUrl, `/api/v1/inventory/tickets/${encodeURIComponent(receiptId)}`, {
      method: 'PATCH',
      body: ticketPatchBody(ticket, null),
    });
    assert.equal(edited.status, 400);
    assert.equal(record(edited.body?.['error'])['code'], 'VALIDATION_ERROR');

    const after = await request(baseUrl, `/api/v1/inventory/tickets/${encodeURIComponent(receiptId)}`);
    assert.equal(record(after.body?.['ticket'])['storeId'], store['id']);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
