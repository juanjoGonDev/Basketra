import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

test('inventory statistics derive ticket spend independently from store price joins', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-inventory-statistics-'));
  const server = new BasketraServer(config(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const categoryResponse = await request(baseUrl, '/api/v1/categories', {
      method: 'POST',
      body: { name: 'Alimentación', color: '#336699' },
    });
    assert.equal(categoryResponse.status, 201);
    const category = record(categoryResponse.body?.['category']);

    const productResponse = await request(baseUrl, '/api/v1/products', {
      method: 'POST',
      body: {
        canonicalName: 'Arroz',
        variantName: 'Arroz 1 kg',
        categoryId: category['id'],
      },
    });
    assert.equal(productResponse.status, 201);
    const product = record(productResponse.body?.['product']);

    const storeResponse = await request(baseUrl, '/api/v1/inventory/stores', {
      method: 'POST',
      body: { retailerName: 'Mercadona', name: 'Mercadona Centro' },
    });
    assert.equal(storeResponse.status, 201);
    const store = record(storeResponse.body?.['store']);

    for (const priceMinor of [180, 195]) {
      const observation = await request(baseUrl, `/api/v1/products/${encodeURIComponent(string(product['id']))}/prices`, {
        method: 'POST',
        body: {
          retailerName: 'Mercadona',
          storeId: store['id'],
          priceMinor,
          observedAt: `2026-09-0${priceMinor === 180 ? '1' : '2'}T10:00:00.000Z`,
        },
      });
      assert.equal(observation.status, 201);
    }

    const imported = await request(baseUrl, '/api/v1/receipts/confirm', {
      method: 'POST',
      body: {
        importKey: 'statistics-ticket-001',
        declaredTotalMinor: 500,
        originalText: 'Arroz 2 250 500',
        retailerName: 'Mercadona',
        items: [{
          description: 'Arroz 1 kg',
          quantity: 2,
          unitPriceMinor: 250,
          lineTotalMinor: 500,
          categoryId: category['id'],
        }],
      },
    });
    assert.equal(imported.status, 201);
    const receiptId = string(imported.body?.['receiptId']);

    const detailResponse = await request(baseUrl, `/api/v1/inventory/tickets/${encodeURIComponent(receiptId)}`);
    assert.equal(detailResponse.status, 200);
    const ticket = record(detailResponse.body?.['ticket']);
    const line = record(array(ticket['items'])[0]);

    const assigned = await request(baseUrl, `/api/v1/inventory/tickets/${encodeURIComponent(receiptId)}`, {
      method: 'PATCH',
      body: {
        purchasedAt: ticket['purchasedAt'],
        storeId: store['id'],
        paymentStatus: 'paid',
        taxMinor: 0,
        receiptDiscountMinor: 0,
        items: [{
          id: line['id'],
          description: line['description'],
          categoryId: category['id'],
          quantity: 2,
          unit: 'unit',
          unitPriceMinor: 250,
        }],
      },
    });
    assert.equal(assigned.status, 200);

    const statisticsResponse = await request(baseUrl, '/api/v1/inventory/statistics?period=all');
    assert.equal(statisticsResponse.status, 200);
    const statistics = record(statisticsResponse.body?.['statistics']);
    const summary = record(statistics['summary']);
    assert.equal(summary['ticketsProcessed'], 1);
    assert.equal(summary['totalSpentMinor'], 500);
    assert.equal(summary['entriesValueMinor'], 500);

    const storeStats = array(statistics['storeStats']).map(record);
    const central = storeStats.find(row => row['id'] === store['id']);
    assert.ok(central);
    assert.equal(central['productCount'], 1);
    assert.equal(central['ticketCount'], 1);
    assert.equal(central['spentMinor'], 500);

    const categoryStats = array(statistics['categoryStats']).map(record);
    const food = categoryStats.find(row => row['id'] === category['id']);
    assert.ok(food);
    assert.equal(food['ticketCount'], 1);
    assert.equal(food['spentMinor'], 500);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
