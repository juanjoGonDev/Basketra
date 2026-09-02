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

function integer(value: unknown): number {
  assert.equal(typeof value, 'number');
  assert.ok(Number.isSafeInteger(value));
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

test('inventory overview exposes canonical counts and latest catalog value in one bounded read model', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-inventory-overview-'));
  const server = new BasketraServer(config(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const initialResponse = await request(baseUrl, '/api/v1/inventory/overview');
    assert.equal(initialResponse.status, 200);
    const initial = record(initialResponse.body?.['overview']);
    assert.equal(integer(initial['latestCatalogValueMinor']), 0);

    const categoryResponse = await request(baseUrl, '/api/v1/categories', {
      method: 'POST',
      body: { name: 'Despensa', color: '#336699' },
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

    for (const [priceMinor, observedAt] of [[180, '2026-09-01T10:00:00.000Z'], [195, '2026-09-02T10:00:00.000Z']] as const) {
      const observation = await request(baseUrl, `/api/v1/products/${encodeURIComponent(string(product['id']))}/prices`, {
        method: 'POST',
        body: {
          retailerName: 'Mercadona',
          storeId: store['id'],
          priceMinor,
          observedAt,
        },
      });
      assert.equal(observation.status, 201);
    }

    const response = await request(baseUrl, '/api/v1/inventory/overview');
    assert.equal(response.status, 200);
    const overview = record(response.body?.['overview']);
    assert.equal(integer(overview['productCount']), integer(initial['productCount']) + 1);
    assert.equal(integer(overview['categoryCount']), integer(initial['categoryCount']) + 1);
    assert.equal(integer(overview['storeCount']), integer(initial['storeCount']) + 1);
    assert.equal(integer(overview['latestCatalogValueMinor']), 195);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
