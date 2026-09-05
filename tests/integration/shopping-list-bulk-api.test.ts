import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

function config(root: string): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir: join(root, 'data'),
    tempDir: join(root, 'tmp'),
  };
}

async function json(baseUrl: string, path: string, method: string, body: unknown) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

test('bulk shopping-list HTTP contract supports completed, Store and delete actions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-bulk-api-'));
  const server = new BasketraServer(config(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;
  try {
    const createdList = await json(baseUrl, '/api/v1/shopping-lists', 'POST', { name: 'Compra bulk API' });
    assert.equal(createdList.response.status, 201);
    const list = createdList.body['list'] as { id: string };

    const storeResponse = await json(baseUrl, '/api/v1/stores', 'POST', {
      retailerName: 'Mercado',
      name: 'Mercado Bulk',
    });
    assert.equal(storeResponse.response.status, 201);
    const store = storeResponse.body['store'] as { id: string };

    const items = [];
    for (const text of ['Leche', 'Pan']) {
      const created = await json(baseUrl, `/api/v1/shopping-lists/${list.id}/items`, 'POST', {
        text,
        quantityMinor: 1,
        unit: 'unit',
        exactRequired: false,
        substitutionAllowed: true,
      });
      assert.equal(created.response.status, 201);
      items.push(created.body['item'] as { id: string; version: number });
    }

    const empty = await json(baseUrl, `/api/v1/shopping-lists/${list.id}/items/bulk`, 'POST', {
      items: [],
      action: 'delete',
    });
    assert.equal(empty.response.status, 400);

    const completed = await json(baseUrl, `/api/v1/shopping-lists/${list.id}/items/bulk`, 'POST', {
      items,
      action: 'completed',
      completed: true,
    });
    assert.equal(completed.response.status, 200);
    const completedItems = completed.body['items'] as Array<{ id: string; version: number; completed: boolean }>;
    assert.ok(completedItems.every((item) => item.completed));

    const stored = await json(baseUrl, `/api/v1/shopping-lists/${list.id}/items/bulk`, 'POST', {
      items: completedItems.map((item) => ({ id: item.id, version: item.version })),
      action: 'store',
      storeOverrideId: store.id,
    });
    assert.equal(stored.response.status, 200);
    const storedItems = stored.body['items'] as Array<{ id: string; version: number; storeOverrideId?: string }>;
    assert.ok(storedItems.every((item) => item.storeOverrideId === store.id));

    const inherited = await json(baseUrl, `/api/v1/shopping-lists/${list.id}/items/bulk`, 'POST', {
      items: storedItems.map((item) => ({ id: item.id, version: item.version })),
      action: 'store',
      storeOverrideId: null,
    });
    assert.equal(inherited.response.status, 200);
    const inheritedItems = inherited.body['items'] as Array<{ id: string; version: number; storeOverrideId?: string }>;
    assert.ok(inheritedItems.every((item) => item.storeOverrideId === undefined));

    const deleted = await json(baseUrl, `/api/v1/shopping-lists/${list.id}/items/bulk`, 'POST', {
      items: inheritedItems.map((item) => ({ id: item.id, version: item.version })),
      action: 'delete',
    });
    assert.equal(deleted.response.status, 200);
    assert.deepEqual(deleted.body['items'], []);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
