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

async function jsonRequest(
  baseUrl: string,
  path: string,
  init: JsonRequestInit = {},
): Promise<Readonly<{ status: number; body: JsonObject | undefined }>> {
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
          resolvePromise({
            status,
            body: expectRecord(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once('error', reject);
    request.end(serializedBody);
  });
}

async function createCategory(
  baseUrl: string,
  body: Readonly<{ name: string; parentId?: string; color: string; description?: string }>,
): Promise<JsonObject> {
  const response = await jsonRequest(baseUrl, '/api/v1/categories', { method: 'POST', body });
  assert.equal(response.status, 201);
  return expectRecord(response.body?.['category']);
}

test('category API exposes nested colored categories and rejects hierarchy cycles', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-category-api-'));
  const server = new BasketraServer(createConfig(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const initial = await jsonRequest(baseUrl, '/api/v1/categories');
    assert.equal(initial.status, 200);
    const initialCategories = expectArray(initial.body?.['categories']);
    const unknown = initialCategories.map(expectRecord).find(category => category['name'] === 'desconocido');
    assert.ok(unknown);
    assert.equal(unknown['color'], '#64748B');
    assert.equal(unknown['parentId'], undefined);

    const food = await createCategory(baseUrl, { name: 'Alimentación', color: '#118844' });
    const chilled = await createCategory(baseUrl, {
      name: 'Refrigerados',
      parentId: expectString(food['id']),
      color: '#22AA55',
    });
    const dairy = await createCategory(baseUrl, {
      name: 'Lácteos',
      parentId: expectString(chilled['id']),
      color: '#33BB66',
      description: 'Leche, yogur y derivados',
    });

    assert.equal(dairy['parentId'], chilled['id']);
    assert.equal(dairy['color'], '#33BB66');
    assert.equal(dairy['description'], 'Leche, yogur y derivados');

    const cycle = await jsonRequest(baseUrl, `/api/v1/categories/${encodeURIComponent(expectString(food['id']))}`, {
      method: 'PATCH',
      body: { parentId: expectString(dairy['id']) },
    });
    assert.equal(cycle.status, 409);
    assert.equal(expectRecord(cycle.body?.['error'])['code'], 'CATEGORY_CYCLE');

    const protectUnknown = await jsonRequest(baseUrl, `/api/v1/categories/${encodeURIComponent(expectString(unknown['id']))}`, {
      method: 'PATCH',
      body: { name: 'Otros' },
    });
    assert.equal(protectUnknown.status, 409);
    assert.equal(expectRecord(protectUnknown.body?.['error'])['code'], 'UNKNOWN_CATEGORY_PROTECTED');

    const final = await jsonRequest(baseUrl, '/api/v1/categories');
    assert.equal(final.status, 200);
    assert.equal(expectArray(final.body?.['categories']).length, initialCategories.length + 3);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
