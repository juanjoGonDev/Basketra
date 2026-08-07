import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

type JsonObject = Record<string, unknown>;

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

function expectNumber(value: unknown): number {
  assert.equal(typeof value, 'number');
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

async function jsonRequest(baseUrl: string, path: string, init: RequestInit = {}): Promise<Readonly<{ response: Response; body: JsonObject | undefined }>> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (response.status === 204) return { response, body: undefined };
  const parsed: unknown = await response.json();
  return { response, body: expectRecord(parsed) };
}

function requiredBody(body: JsonObject | undefined): JsonObject {
  assert.ok(body);
  return body;
}

async function readInvalidation(response: Response): Promise<JsonObject> {
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
        const parsed: unknown = JSON.parse(data.slice(6));
        return expectRecord(parsed);
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
    const list = expectRecord(requiredBody(createdList.body).list);
    const listId = expectString(list.id);
    const listVersion = expectNumber(list.version);
    assert.ok(listVersion >= 1);

    const createdItem = await jsonRequest(baseUrl, `/api/v1/shopping-lists/${encodeURIComponent(listId)}/items`, {
      method: 'POST',
      body: JSON.stringify({ text: 'Leche', quantityMinor: 1, unit: 'unit', exactRequired: false, substitutionAllowed: true }),
    });
    assert.equal(createdItem.response.status, 201);
    const item = expectRecord(requiredBody(createdItem.body).item);
    const itemId = expectString(item.id);
    const itemVersion = expectNumber(item.version);

    const realtime = await fetch(`${baseUrl}/api/v1/realtime`, { signal: realtimeAbort.signal });
    assert.equal(realtime.status, 200);
    assert.match(realtime.headers.get('content-type') ?? '', /^text\/event-stream/);
    const nextInvalidation = readInvalidation(realtime);

    const updated = await jsonRequest(baseUrl, `/api/v1/shopping-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ text: 'Leche entera', version: itemVersion }),
    });
    assert.equal(updated.response.status, 200);
    const updatedItem = expectRecord(requiredBody(updated.body).item);
    const updatedVersion = expectNumber(updatedItem.version);
    const updatedAt = expectString(updatedItem.updatedAt);
    assert.equal(updatedVersion, itemVersion + 1);

    const invalidation = await nextInvalidation;
    assert.deepEqual(invalidation, {
      entityType: 'shopping-list-item',
      mutation: 'updated',
      updatedAt,
      version: updatedVersion,
      listId,
      entityId: itemId,
    });
    assert.equal(JSON.stringify(invalidation).includes('Leche entera'), false);

    const stale = await jsonRequest(baseUrl, `/api/v1/shopping-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ text: 'Leche obsoleta', version: itemVersion }),
    });
    assert.equal(stale.response.status, 409);
    const staleError = expectRecord(requiredBody(stale.body).error);
    assert.equal(staleError.code, 'SHOPPING_CONFLICT');
    const staleDetails = expectRecord(staleError.details);
    assert.equal(staleDetails.kind, 'item');
    const current = expectRecord(staleDetails.current);
    assert.equal(current.text, 'Leche entera');
    const currentVersion = expectNumber(current.version);
    assert.equal(currentVersion, itemVersion + 1);

    const retried = await jsonRequest(baseUrl, `/api/v1/shopping-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ text: 'Leche elegida', version: currentVersion }),
    });
    assert.equal(retried.response.status, 200);
    const retriedItem = expectRecord(requiredBody(retried.body).item);
    assert.equal(retriedItem.text, 'Leche elegida');
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
    const category = expectRecord(requiredBody(categoryResponse.body).category);
    const categoryId = expectString(category.id);

    const productResponse = await jsonRequest(baseUrl, '/api/v1/products', {
      method: 'POST',
      body: JSON.stringify({
        canonicalName: 'Leche entera',
        variantName: 'Leche entera 1 L',
        categoryId,
        brand: 'Marca',
        ean: '8412345678901',
        packageMinor: 1,
        packageUnit: 'l',
        aliases: ['leche'],
      }),
    });
    assert.equal(productResponse.response.status, 201);
    const createdProduct = expectRecord(requiredBody(productResponse.body).product);
    const productId = expectString(createdProduct.id);

    const suggestions = await jsonRequest(baseUrl, '/api/v1/products/suggestions?q=leche');
    assert.equal(suggestions.response.status, 200);
    const suggestionEntries = expectArray(requiredBody(suggestions.body).suggestions);
    assert.ok(suggestionEntries.length > 0);
    const firstSuggestion = expectRecord(suggestionEntries[0]);
    assert.equal(firstSuggestion.id, productId);
    assert.equal(firstSuggestion.categoryName, 'Lácteos');

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
    const firstObservation = expectRecord(requiredBody(firstPrice.body).observation);
    assert.equal(firstObservation.priceMinor, 129);
    const firstObservationId = expectString(firstObservation.id);

    const secondPrice = await jsonRequest(baseUrl, `/api/v1/products/${encodeURIComponent(productId)}/prices`, {
      method: 'POST',
      body: JSON.stringify({ priceMinor: 139, retailerName: 'Mercado', evidenceType: 'manual' }),
    });
    assert.equal(secondPrice.response.status, 201);
    const secondObservation = expectRecord(requiredBody(secondPrice.body).observation);
    assert.notEqual(expectString(secondObservation.id), firstObservationId);

    const product = await jsonRequest(baseUrl, `/api/v1/products/${encodeURIComponent(productId)}`);
    assert.equal(product.response.status, 200);
    const priceHistory = expectArray(requiredBody(product.body).priceHistory);
    assert.equal(priceHistory.length, 2);
    assert.deepEqual(priceHistory.map(entry => expectNumber(expectRecord(entry).priceMinor)), [139, 129]);

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
    const createdStore = expectRecord(requiredBody(store.body).store);
    const storeId = expectString(createdStore.id);
    const stores = await jsonRequest(baseUrl, '/api/v1/stores/suggestions?latitudeMicrodegrees=40416775&longitudeMicrodegrees=-3703790&maximumDistanceMeters=1000');
    assert.equal(stores.response.status, 200);
    const storeEntries = expectArray(requiredBody(stores.body).stores);
    assert.ok(storeEntries.length > 0);
    const firstStore = expectRecord(storeEntries[0]);
    assert.equal(firstStore.id, storeId);
    assert.ok(expectNumber(firstStore.distanceMeters) < 100);

    const externalFailure = await jsonRequest(baseUrl, '/api/v1/stores/nearby', {
      method: 'POST',
      body: JSON.stringify({ latitudeMicrodegrees: 40_416_775, longitudeMicrodegrees: -3_703_790, radiusMeters: 1_000, limit: 8 }),
    });
    assert.equal(externalFailure.response.status, 502);
    const externalError = expectRecord(requiredBody(externalFailure.body).error);
    assert.equal(externalError.code, 'NEARBY_STORE_PROVIDER_UNAVAILABLE');

    const aiUnavailable = await jsonRequest(baseUrl, '/api/v1/products/photo-proposal', {
      method: 'POST',
      body: JSON.stringify({ storageKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg' }),
    });
    assert.equal(aiUnavailable.response.status, 503);
    const aiError = expectRecord(requiredBody(aiUnavailable.body).error);
    assert.equal(aiError.code, 'AI_NOT_CONFIGURED');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
