import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

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

async function jsonRequest(baseUrl: string, path: string, init: RequestInit = {}): Promise<Readonly<{ response: Response; body: any }>> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = response.status === 204 ? undefined : await response.json();
  return { response, body };
}

async function readInvalidation(response: Response): Promise<Record<string, unknown>> {
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('Realtime stream ended before invalidation');
      buffer += decoder.decode(chunk.value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        if (!block.includes('event: invalidate')) continue;
        const data = block.split('\n').find((line) => line.startsWith('data: '));
        if (!data) continue;
        return JSON.parse(data.slice(6)) as Record<string, unknown>;
      }
    }
  } finally {
    await reader.cancel();
  }
}

test('HTTP API exposes optimistic conflicts and minimal realtime invalidations', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-collaboration-api-'));
  const server = new BasketraServer(createConfig(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;
  const realtimeAbort = new AbortController();
  try {
    const createdList = await jsonRequest(baseUrl, '/api/v1/shopping-lists', {
      method: 'POST',
      body: JSON.stringify({ name: 'Compra compartida' }),
    });
    assert.equal(createdList.response.status, 201);
    const list = createdList.body.list as { id: string; version: number };

    const createdItem = await jsonRequest(baseUrl, `/api/v1/shopping-lists/${encodeURIComponent(list.id)}/items`, {
      method: 'POST',
      body: JSON.stringify({ text: 'Leche', quantityMinor: 1, unit: 'unit', exactRequired: false, substitutionAllowed: true }),
    });
    assert.equal(createdItem.response.status, 201);
    const item = createdItem.body.item as { id: string; version: number };

    const realtime = await fetch(`${baseUrl}/api/v1/realtime`, { signal: realtimeAbort.signal });
    assert.equal(realtime.status, 200);
    assert.match(realtime.headers.get('content-type') ?? '', /^text\/event-stream/);
    const nextInvalidation = readInvalidation(realtime);

    const updated = await jsonRequest(baseUrl, `/api/v1/shopping-lists/${encodeURIComponent(list.id)}/items/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ text: 'Leche entera', version: item.version }),
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.item.version, item.version + 1);

    const invalidation = await nextInvalidation;
    assert.deepEqual(invalidation, {
      entityType: 'shopping-list-item',
      mutation: 'updated',
      updatedAt: updated.body.item.updatedAt,
      version: updated.body.item.version,
      listId: list.id,
      entityId: item.id,
    });
    assert.equal(JSON.stringify(invalidation).includes('Leche entera'), false);

    const stale = await jsonRequest(baseUrl, `/api/v1/shopping-lists/${encodeURIComponent(list.id)}/items/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ text: 'Leche obsoleta', version: item.version }),
    });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.body.error.code, 'SHOPPING_CONFLICT');
    assert.equal(stale.body.error.details.kind, 'item');
    assert.equal(stale.body.error.details.current.text, 'Leche entera');
    assert.equal(stale.body.error.details.current.version, item.version + 1);

    const retried = await jsonRequest(baseUrl, `/api/v1/shopping-lists/${encodeURIComponent(list.id)}/items/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ text: 'Leche elegida', version: stale.body.error.details.current.version }),
    });
    assert.equal(retried.response.status, 200);
    assert.equal(retried.body.item.text, 'Leche elegida');
  } finally {
    realtimeAbort.abort();
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('catalog, confirmed price evidence and location contracts remain deterministic', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-catalog-api-'));
  const server = new BasketraServer(createConfig(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;
  try {
    const categoryResponse = await jsonRequest(baseUrl, '/api/v1/categories', {
      method: 'POST',
      body: JSON.stringify({ name: 'Lácteos' }),
    });
    assert.equal(categoryResponse.response.status, 201);

    const productResponse = await jsonRequest(baseUrl, '/api/v1/products', {
      method: 'POST',
      body: JSON.stringify({
        canonicalName: 'Leche entera',
        variantName: 'Leche entera 1 L',
        categoryId: categoryResponse.body.category.id,
        brand: 'Marca',
        ean: '8412345678901',
        packageMinor: 1,
        packageUnit: 'l',
        aliases: ['leche'],
      }),
    });
    assert.equal(productResponse.response.status, 201);
    const productId = productResponse.body.product.id as string;

    const suggestions = await jsonRequest(baseUrl, '/api/v1/products/suggestions?q=leche');
    assert.equal(suggestions.response.status, 200);
    assert.equal(suggestions.body.suggestions[0].id, productId);
    assert.equal(suggestions.body.suggestions[0].categoryName, 'Lácteos');

    const noRetailer = await jsonRequest(baseUrl, `/api/v1/products/${encodeURIComponent(productId)}/prices`, {
      method: 'POST',
      body: JSON.stringify({ priceMinor: 129 }),
    });
    assert.equal(noRetailer.response.status, 400);

    const firstPrice = await jsonRequest(baseUrl, `/api/v1/products/${encodeURIComponent(productId)}/prices`, {
      method: 'POST',
      body: JSON.stringify({ priceMinor: 129, retailerName: 'Mercado', evidenceType: 'manual' }),
    });
    assert.equal(firstPrice.response.status, 201);
    assert.equal(firstPrice.body.observation.priceMinor, 129);

    const secondPrice = await jsonRequest(baseUrl, `/api/v1/products/${encodeURIComponent(productId)}/prices`, {
      method: 'POST',
      body: JSON.stringify({ priceMinor: 139, retailerName: 'Mercado', evidenceType: 'manual' }),
    });
    assert.equal(secondPrice.response.status, 201);
    assert.notEqual(secondPrice.body.observation.id, firstPrice.body.observation.id);

    const product = await jsonRequest(baseUrl, `/api/v1/products/${encodeURIComponent(productId)}`);
    assert.equal(product.response.status, 200);
    assert.equal(product.body.priceHistory.length, 2);
    assert.deepEqual(product.body.priceHistory.map((entry: { priceMinor: number }) => entry.priceMinor), [139, 129]);

    const store = await jsonRequest(baseUrl, '/api/v1/stores', {
      method: 'POST',
      body: JSON.stringify({
        retailerName: 'Mercado',
        name: 'Mercado Centro',
        address: 'Calle Mayor 1, Madrid',
        latitudeMicrodegrees: 40_416_800,
        longitudeMicrodegrees: -3_703_800,
      }),
    });
    assert.equal(store.response.status, 201);
    const stores = await jsonRequest(baseUrl, '/api/v1/stores/suggestions?latitudeMicrodegrees=40416775&longitudeMicrodegrees=-3703790&maximumDistanceMeters=1000');
    assert.equal(stores.response.status, 200);
    assert.equal(stores.body.stores[0].id, store.body.store.id);
    assert.ok(stores.body.stores[0].distanceMeters < 100);

    const externalFailure = await jsonRequest(baseUrl, '/api/v1/stores/nearby', {
      method: 'POST',
      body: JSON.stringify({ latitudeMicrodegrees: 40_416_775, longitudeMicrodegrees: -3_703_790, radiusMeters: 1_000, limit: 8 }),
    });
    assert.equal(externalFailure.response.status, 502);
    assert.equal(externalFailure.body.error.code, 'NEARBY_STORE_PROVIDER_UNAVAILABLE');

    const aiUnavailable = await jsonRequest(baseUrl, '/api/v1/products/photo-proposal', {
      method: 'POST',
      body: JSON.stringify({ storageKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg' }),
    });
    assert.equal(aiUnavailable.response.status, 503);
    assert.equal(aiUnavailable.body.error.code, 'AI_NOT_CONFIGURED');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
