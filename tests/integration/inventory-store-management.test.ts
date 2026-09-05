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

async function createStore(baseUrl: string, name: string, retailerName = 'Mercadona'): Promise<JsonObject> {
  const response = await request(baseUrl, '/api/v1/inventory/stores', {
    method: 'POST',
    body: {
      retailerName,
      name,
      region: 'Sevilla',
      address: `${name} · Avenida de prueba 1`,
    },
  });
  assert.equal(response.status, 201);
  return record(response.body?.['store']);
}

test('store management is paginated, editable and dependency-aware', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-inventory-stores-'));
  const server = new BasketraServer(config(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const central = await createStore(baseUrl, 'Mercadona Centro');
    const removable = await createStore(baseUrl, 'Mercadona Temporal');

    const firstPage = await request(baseUrl, '/api/v1/inventory/stores?q=centro&sort=name&limit=1&offset=0');
    assert.equal(firstPage.status, 200);
    assert.equal(firstPage.body?.['total'], 1);
    assert.equal(firstPage.body?.['hasMore'], false);
    assert.equal(record(array(firstPage.body?.['stores'])[0])['id'], central['id']);

    const edited = await request(baseUrl, `/api/v1/inventory/stores/${encodeURIComponent(string(central['id']))}`, {
      method: 'PATCH',
      body: {
        retailerName: 'Mercadona',
        name: 'Mercadona Centro Norte',
        region: 'Sevilla',
        address: 'Avenida Norte 10',
      },
    });
    assert.equal(edited.status, 200);
    const editedStore = record(edited.body?.['store']);
    assert.equal(editedStore['name'], 'Mercadona Centro Norte');
    assert.equal(editedStore['address'], 'Avenida Norte 10');

    const productResponse = await request(baseUrl, '/api/v1/products', {
      method: 'POST',
      body: { canonicalName: 'Arroz', variantName: 'Arroz 1 kg' },
    });
    assert.equal(productResponse.status, 201);
    const product = record(productResponse.body?.['product']);

    const observation = await request(baseUrl, `/api/v1/products/${encodeURIComponent(string(product['id']))}/prices`, {
      method: 'POST',
      body: {
        retailerName: 'Mercadona',
        storeId: central['id'],
        priceMinor: 195,
      },
    });
    assert.equal(observation.status, 201);

    const impact = await request(baseUrl, `/api/v1/inventory/stores/${encodeURIComponent(string(central['id']))}/delete-impact`);
    assert.equal(impact.status, 200);
    const dependencies = record(impact.body?.['impact']);
    assert.equal(dependencies['linkedProducts'], 1);
    assert.equal(dependencies['priceObservations'], 1);
    assert.equal(dependencies['canDelete'], false);

    const blockedDelete = await request(baseUrl, `/api/v1/inventory/stores/${encodeURIComponent(string(central['id']))}`, { method: 'DELETE' });
    assert.equal(blockedDelete.status, 409);
    assert.equal(record(blockedDelete.body?.['error'])['code'], 'STORE_DELETE_BLOCKED');

    const removableImpact = await request(baseUrl, `/api/v1/inventory/stores/${encodeURIComponent(string(removable['id']))}/delete-impact`);
    assert.equal(removableImpact.status, 200);
    assert.equal(record(removableImpact.body?.['impact'])['canDelete'], true);

    const deleted = await request(baseUrl, `/api/v1/inventory/stores/${encodeURIComponent(string(removable['id']))}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);

    const missing = await request(baseUrl, `/api/v1/inventory/stores/${encodeURIComponent(string(removable['id']))}`);
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
