import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { BasketraServer } from '../../src/api/server.ts';
import { BasketraDatabase } from '../../src/infrastructure/database.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

type JsonObject = Record<string, unknown>;

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

async function request(baseUrl: string, path: string, method = 'GET', body?: unknown) {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  return await new Promise<{ status: number; body?: JsonObject }>((resolve, reject) => {
    const req = httpRequest(new URL(path, baseUrl), {
      method,
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
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw ? { status: response.statusCode ?? 0, body: record(JSON.parse(raw)) } : { status: response.statusCode ?? 0 });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.once('error', reject);
    req.end(serialized);
  });
}

async function createProduct(baseUrl: string, name: string): Promise<string> {
  const response = await request(baseUrl, '/api/v1/products', 'POST', { canonicalName: name, variantName: name });
  assert.equal(response.status, 201);
  return String(record(response.body?.['product'])['id']);
}

test('product bulk preflight reports blocked ids and bulk delete is all-or-nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-product-bulk-delete-'));
  const server = new BasketraServer(config(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const deletable = await createProduct(baseUrl, 'Producto eliminable');
    const blocked = await createProduct(baseUrl, 'Producto con precio');
    const database = new BasketraDatabase(join(root, 'data', 'basketra.db'));
    database.confirmPriceObservation({
      productVariantId: blocked,
      retailerName: 'Mercado',
      priceMinor: 120,
      packageNumerator: 1,
      packageDenominator: 1,
      packageUnit: 'unit',
      observedAt: '2026-09-04T08:00:00.000Z',
      confidence: 1,
      evidence: { sourceType: 'manual', sourceReference: 'bulk-product-price' },
    });
    database.close();

    const impactResponse = await request(baseUrl, '/api/v1/catalog/products/bulk-delete-impact', 'POST', { ids: [deletable, blocked] });
    assert.equal(impactResponse.status, 200);
    const impact = record(impactResponse.body?.['impact']);
    assert.equal(impact['canDelete'], false);
    assert.deepEqual(impact['deletableIds'], [deletable]);
    const blockedRows = array(impact['blocked']);
    assert.equal(blockedRows.length, 1);
    assert.equal(record(blockedRows[0])['id'], blocked);

    const blockedDelete = await request(baseUrl, '/api/v1/catalog/products/bulk-delete', 'POST', { ids: [deletable, blocked] });
    assert.equal(blockedDelete.status, 409);
    assert.equal(record(blockedDelete.body?.['error'])['code'], 'PRODUCT_BULK_DELETE_BLOCKED');
    assert.equal((await request(baseUrl, `/api/v1/products/${deletable}`)).status, 200);
    assert.equal((await request(baseUrl, `/api/v1/products/${blocked}`)).status, 200);

    const deleted = await request(baseUrl, '/api/v1/catalog/products/bulk-delete', 'POST', { ids: [deletable] });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body?.['deletedIds'], [deletable]);
    assert.equal((await request(baseUrl, `/api/v1/products/${deletable}`)).status, 404);
    assert.equal((await request(baseUrl, `/api/v1/products/${blocked}`)).status, 200);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
