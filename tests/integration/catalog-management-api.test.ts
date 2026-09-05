import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

type JsonObject = Record<string, unknown>;

type JsonRequestInit = Readonly<{
  method?: string;
  body?: unknown;
}>;

function expectRecord(value: unknown): JsonObject {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as JsonObject;
}

function expectArray(value: unknown): readonly unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

function expectString(value: unknown): string {
  assert.equal(typeof value, 'string');
  return value;
}

function createConfig(root: string): AppConfig {
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

async function jsonRequest(baseUrl: string, path: string, init: JsonRequestInit = {}): Promise<Readonly<{ status: number; body: JsonObject | undefined }>> {
  const serializedBody = init.body === undefined ? undefined : JSON.stringify(init.body);
  return await new Promise((resolvePromise, reject) => {
    const request = httpRequest(new URL(path, baseUrl), {
      method: init.method ?? 'GET',
      agent: false,
      headers: serializedBody === undefined
        ? undefined
        : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(serializedBody) },
    }, (response: IncomingMessage) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.once('error', reject);
      response.once('end', () => {
        try {
          const status = response.statusCode ?? 0;
          if (status === 204) {
            resolvePromise({ status, body: undefined });
            return;
          }
          const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolvePromise({ status, body: expectRecord(body) });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once('error', reject);
    request.end(serializedBody);
  });
}

async function createProduct(baseUrl: string, canonicalName: string, variantName: string): Promise<JsonObject> {
  const response = await jsonRequest(baseUrl, '/api/v1/products', {
    method: 'POST',
    body: { canonicalName, variantName },
  });
  assert.equal(response.status, 201);
  return expectRecord(response.body?.['product']);
}

test('catalog API lists, relates and labels persisted product variants without a parallel catalog model', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-catalog-api-'));
  const server = new BasketraServer(createConfig(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const milk = await createProduct(baseUrl, 'Leche', 'Leche entera 1 L');
    const dairy = await createProduct(baseUrl, 'Lácteos', 'Lácteo base');
    const milkId = expectString(milk['id']);
    const dairyParentId = expectString(dairy['canonicalProductId']);

    const initial = await jsonRequest(baseUrl, '/api/v1/catalog?limit=50&offset=0');
    assert.equal(initial.status, 200);
    const initialCatalog = expectRecord(initial.body?.['catalog']);
    assert.equal(expectArray(initialCatalog['products']).length, 2);
    assert.equal(expectArray(initialCatalog['parents']).length, 2);

    const retailerName = await jsonRequest(baseUrl, `/api/v1/catalog/products/${encodeURIComponent(milkId)}/retailer-name`, {
      method: 'PUT',
      body: { retailerName: 'Mercadona', title: 'Leche entera Hacendado 1L' },
    });
    assert.equal(retailerName.status, 200);
    const listing = expectRecord(retailerName.body?.['retailerName']);
    assert.equal(listing['retailerName'], 'Mercadona');
    assert.equal(listing['title'], 'Leche entera Hacendado 1L');

    const retailerNameUpdate = await jsonRequest(baseUrl, `/api/v1/catalog/products/${encodeURIComponent(milkId)}/retailer-name`, {
      method: 'PUT',
      body: { retailerName: 'mercadona', title: 'Leche entera Hacendado 1 L' },
    });
    assert.equal(retailerNameUpdate.status, 200);
    assert.equal(expectString(expectRecord(retailerNameUpdate.body?.['retailerName'])['retailerId']), expectString(listing['retailerId']));

    const retailerFiltered = await jsonRequest(baseUrl, '/api/v1/catalog?q=Mercadona&limit=50&offset=0');
    assert.equal(retailerFiltered.status, 200);
    assert.equal(expectArray(expectRecord(retailerFiltered.body?.['catalog'])['products']).length, 1);

    const existingParent = await jsonRequest(baseUrl, `/api/v1/catalog/products/${encodeURIComponent(milkId)}/parent`, {
      method: 'PUT',
      body: { canonicalProductId: dairyParentId },
    });
    assert.equal(existingParent.status, 200);
    const moved = await jsonRequest(baseUrl, `/api/v1/products/${encodeURIComponent(milkId)}`);
    assert.equal(moved.status, 200);
    assert.equal(expectRecord(moved.body?.['product'])['canonicalProductId'], dairyParentId);
    assert.equal(expectRecord(moved.body?.['product'])['canonicalName'], 'Lácteos');

    const newParent = await jsonRequest(baseUrl, `/api/v1/catalog/products/${encodeURIComponent(milkId)}/parent`, {
      method: 'PUT',
      body: { newParentName: 'Leche fresca' },
    });
    assert.equal(newParent.status, 200);
    const newParentId = expectString(expectRecord(newParent.body?.['relation'])['canonicalProductId']);
    assert.notEqual(newParentId, dairyParentId);
    const remapped = await jsonRequest(baseUrl, `/api/v1/products/${encodeURIComponent(milkId)}`);
    assert.equal(expectRecord(remapped.body?.['product'])['canonicalName'], 'Leche fresca');

    const filtered = await jsonRequest(baseUrl, '/api/v1/catalog?q=Hacendado&limit=50&offset=0');
    assert.equal(filtered.status, 200);
    const filteredProducts = expectArray(expectRecord(filtered.body?.['catalog'])['products']);
    assert.equal(filteredProducts.length, 1);
    const filteredProduct = expectRecord(filteredProducts[0]);
    const names = expectArray(filteredProduct['retailerNames']);
    assert.equal(names.length, 1);
    assert.equal(expectRecord(names[0])['title'], 'Leche entera Hacendado 1 L');

    const malformedPath = await jsonRequest(baseUrl, '/api/v1/catalog/products/%E0%A4%A/parent', {
      method: 'PUT',
      body: { canonicalProductId: dairyParentId },
    });
    assert.equal(malformedPath.status, 400);
    assert.equal(expectRecord(malformedPath.body?.['error'])['code'], 'INVALID_PATH_PARAMETER');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('receipt line calculation endpoint returns the domain-derived total and rejects excessive discounts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-line-calc-api-'));
  const server = new BasketraServer(createConfig(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const calculated = await jsonRequest(baseUrl, '/api/v1/receipts/calculate-line', {
      method: 'POST',
      body: { quantity: 2, unitPriceMinor: 125, discountMinor: 20 },
    });
    assert.equal(calculated.status, 200);
    assert.equal(calculated.body?.['lineTotalMinor'], 230);

    const invalid = await jsonRequest(baseUrl, '/api/v1/receipts/calculate-line', {
      method: 'POST',
      body: { quantity: 1, unitPriceMinor: 100, discountMinor: 101 },
    });
    assert.equal(invalid.status, 400);
    assert.equal(expectRecord(invalid.body?.['error'])['code'], 'VALIDATION_ERROR');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('product creation accepts omitted optional strings but rejects null optional strings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-catalog-optional-contract-'));
  const server = new BasketraServer(createConfig(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const omitted = await jsonRequest(baseUrl, '/api/v1/products', {
      method: 'POST',
      body: { canonicalName: 'Arroz', variantName: 'Arroz largo' },
    });
    assert.equal(omitted.status, 201);

    const nullOptional = await jsonRequest(baseUrl, '/api/v1/products', {
      method: 'POST',
      body: { canonicalName: 'Arroz', variantName: 'Arroz largo', brand: null },
    });
    assert.equal(nullOptional.status, 400);
    assert.equal(expectRecord(nullOptional.body?.['error'])['code'], 'VALIDATION_ERROR');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
