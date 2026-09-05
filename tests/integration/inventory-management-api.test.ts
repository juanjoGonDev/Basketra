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
      headers: serialized === undefined ? undefined : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(serialized) },
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

async function createCategory(baseUrl: string, name: string, parentId?: string): Promise<JsonObject> {
  const response = await request(baseUrl, '/api/v1/categories', {
    method: 'POST',
    body: { name, color: '#336699', ...(parentId ? { parentId } : {}) },
  });
  assert.equal(response.status, 201);
  return record(response.body?.['category']);
}

async function createProduct(baseUrl: string, canonicalName: string, categoryId?: string): Promise<JsonObject> {
  const response = await request(baseUrl, '/api/v1/products', {
    method: 'POST',
    body: { canonicalName, variantName: `${canonicalName} variante`, ...(categoryId ? { categoryId } : {}) },
  });
  assert.equal(response.status, 201);
  return record(response.body?.['product']);
}

test('inventory catalog is server-paginated/filterable and destructive actions require a dependency preflight', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-inventory-management-'));
  const server = new BasketraServer(config(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const food = await createCategory(baseUrl, 'Alimentación');
    const empty = await createCategory(baseUrl, 'Vacía');
    const dairy = await createCategory(baseUrl, 'Lácteos', string(food['id']));
    const milk = await createProduct(baseUrl, 'Leche', string(dairy['id']));
    const rice = await createProduct(baseUrl, 'Arroz', string(food['id']));
    const orphan = await createProduct(baseUrl, 'Temporal');

    const price = await request(baseUrl, `/api/v1/products/${encodeURIComponent(string(milk['id']))}/prices`, {
      method: 'POST',
      body: { retailerName: 'Mercadona', priceMinor: 125 },
    });
    assert.equal(price.status, 201);

    const page = await request(baseUrl, `/api/v1/catalog?categoryId=${encodeURIComponent(string(dairy['id']))}&price=with-price&sort=price-desc&limit=1&offset=0`);
    assert.equal(page.status, 200);
    const catalog = record(page.body?.['catalog']);
    assert.equal(catalog['total'], 1);
    assert.equal(catalog['hasMore'], false);
    assert.equal(record(array(catalog['products'])[0])['id'], milk['id']);

    const named = await request(baseUrl, '/api/v1/catalog?q=arroz&sort=name&limit=1&offset=0');
    assert.equal(named.status, 200);
    assert.equal(record(named.body?.['catalog'])['total'], 1);
    assert.equal(record(array(record(named.body?.['catalog'])['products'])[0])['id'], rice['id']);

    const categories = await request(baseUrl, '/api/v1/categories?mode=inventory&view=with-children&limit=10&offset=0');
    assert.equal(categories.status, 200);
    const categoryInventory = record(categories.body?.['inventory']);
    assert.equal(categoryInventory['total'], 1);
    const foodSummary = record(array(categoryInventory['categories'])[0]);
    assert.equal(foodSummary['id'], food['id']);
    assert.equal(foodSummary['productCount'], 1);
    assert.equal(foodSummary['childCount'], 1);
    assert.equal(foodSummary['descendantProductCount'], 1);

    const productImpact = await request(baseUrl, `/api/v1/catalog/products/${encodeURIComponent(string(milk['id']))}/delete-impact`);
    assert.equal(productImpact.status, 200);
    const impact = record(productImpact.body?.['impact']);
    assert.equal(impact['priceObservations'], 1);
    assert.equal(impact['canDelete'], false);

    const blockedProductDelete = await request(baseUrl, `/api/v1/catalog/products/${encodeURIComponent(string(milk['id']))}`, { method: 'DELETE' });
    assert.equal(blockedProductDelete.status, 409);
    assert.equal(record(blockedProductDelete.body?.['error'])['code'], 'PRODUCT_DELETE_BLOCKED');

    const orphanImpact = await request(baseUrl, `/api/v1/catalog/products/${encodeURIComponent(string(orphan['id']))}/delete-impact`);
    assert.equal(record(orphanImpact.body?.['impact'])['canDelete'], true);
    const orphanDelete = await request(baseUrl, `/api/v1/catalog/products/${encodeURIComponent(string(orphan['id']))}`, { method: 'DELETE' });
    assert.equal(orphanDelete.status, 200);
    assert.equal(orphanDelete.body?.['deleted'], true);

    const categoryImpact = await request(baseUrl, `/api/v1/categories/${encodeURIComponent(string(food['id']))}/delete-impact`);
    assert.equal(categoryImpact.status, 200);
    const categoryDependencies = record(categoryImpact.body?.['impact']);
    assert.equal(categoryDependencies['productCount'], 1);
    assert.equal(categoryDependencies['childCount'], 1);
    assert.equal(categoryDependencies['descendantProductCount'], 1);
    assert.equal(categoryDependencies['canDelete'], false);

    const blockedCategoryDelete = await request(baseUrl, `/api/v1/categories/${encodeURIComponent(string(food['id']))}`, { method: 'DELETE' });
    assert.equal(blockedCategoryDelete.status, 409);
    assert.equal(record(blockedCategoryDelete.body?.['error'])['code'], 'CATEGORY_DELETE_BLOCKED');

    const emptyImpact = await request(baseUrl, `/api/v1/categories/${encodeURIComponent(string(empty['id']))}/delete-impact`);
    assert.equal(record(emptyImpact.body?.['impact'])['canDelete'], true);
    const emptyDelete = await request(baseUrl, `/api/v1/categories/${encodeURIComponent(string(empty['id']))}`, { method: 'DELETE' });
    assert.equal(emptyDelete.status, 200);
    assert.equal(emptyDelete.body?.['deleted'], true);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
