import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00]);
const pngBase64 = Buffer.from(pngBytes).toString('base64');
const pdfBase64 = Buffer.from(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x00])).toString('base64');

async function request(baseUrl: string, path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

test('HTTP API works without an application token and completes list and receipt workflows', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-api-'));
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 0,
    dataDir: join(root, 'data'),
    tempDir: join(root, 'tmp'),
    maxBodyBytes: 16_384,
    aiTimeoutMs: 1_000,
    aiMaxRetries: 1,
    aiImageCapability: true,
    aiPdfCapability: false,
    overpassBaseUrl: 'http://127.0.0.1:9/api/',
    idleHibernateAfterMs: 10,
    idleExitAfterMs: 0,
  };
  const server = new BasketraServer(config);
  await server.listen();
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const health = await request(baseUrl, '/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await json(health), { status: 'ok' });
    assert.equal((await request(baseUrl, '/readiness')).status, 200);
    assert.equal((await request(baseUrl, '/api/v1/diagnostics')).status, 200);
    assert.equal((await request(baseUrl, '/api/v1/diagnostics', { headers: { authorization: 'Bearer wrong' } })).status, 200);

    const metadata = await json<{ units: string[]; files: { mimeTypes: string[]; maxBytes: number } }>(await request(baseUrl, '/api/v1/meta'));
    assert.ok(metadata.units.includes('unit'));
    assert.deepEqual(metadata.files.mimeTypes, ['image/jpeg', 'image/png', 'application/pdf']);
    assert.equal(metadata.files.maxBytes, config.maxBodyBytes);

    const aiSettings = await request(baseUrl, '/api/v1/settings/ai-provider');
    assert.deepEqual(await json(aiSettings), { configured: false });
    const aiUnavailable = await request(baseUrl, '/api/v1/ai/shopping-list-analysis', { method: 'POST', body: JSON.stringify({ text: 'milk and rice' }) });
    assert.equal(aiUnavailable.status, 503);

    const created = await request(baseUrl, '/api/v1/shopping-lists', { method: 'POST', body: JSON.stringify({ name: 'Semanal' }) });
    assert.equal(created.status, 201);
    const createdList = (await json<{ list: { id: string; version: number } }>(created)).list;
    const listId = createdList.id;
    let listVersion = createdList.version;

    const renamed = await request(baseUrl, `/api/v1/shopping-lists/${listId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Compra semanal', version: listVersion }),
    });
    assert.equal(renamed.status, 200);
    const renamedList = (await json<{ list: { name: string; version: number } }>(renamed)).list;
    assert.equal(renamedList.name, 'Compra semanal');
    listVersion = renamedList.version;

    const firstAdded = await request(baseUrl, `/api/v1/shopping-lists/${listId}/items`, {
      method: 'POST',
      body: JSON.stringify({ text: 'Leche', quantityMinor: 2, unit: 'l', exactRequired: true, substitutionAllowed: false }),
    });
    const firstAddedBody = await json<{ item: { id: string; version: number }; listVersion: number }>(firstAdded);
    const firstItem = firstAddedBody.item;
    let firstItemVersion = firstItem.version;
    listVersion = firstAddedBody.listVersion;

    const secondAdded = await request(baseUrl, `/api/v1/shopping-lists/${listId}/items`, {
      method: 'POST',
      body: JSON.stringify({ text: 'Arroz', quantityMinor: 1, unit: 'kg' }),
    });
    const secondAddedBody = await json<{ item: { id: string; version: number }; listVersion: number }>(secondAdded);
    const secondItem = secondAddedBody.item;
    let secondItemVersion = secondItem.version;
    listVersion = secondAddedBody.listVersion;
    assert.equal(firstAdded.status, 201);
    assert.equal(secondAdded.status, 201);

    const incremented = await request(baseUrl, `/api/v1/shopping-lists/${listId}/items/${firstItem.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantityDelta: 1, version: firstItemVersion }),
    });
    const incrementedBody = await json<{ item: { quantityMinor: number; version: number }; listVersion: number }>(incremented);
    assert.equal(incrementedBody.item.quantityMinor, 3);
    firstItemVersion = incrementedBody.item.version;
    listVersion = incrementedBody.listVersion;

    const completed = await request(baseUrl, `/api/v1/shopping-lists/${listId}/items/${secondItem.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ completed: true, version: secondItemVersion }),
    });
    const completedBody = await json<{ item: { completed: boolean; completedAt?: string; version: number }; listVersion: number }>(completed);
    assert.equal(completedBody.item.completed, true);
    assert.match(completedBody.item.completedAt ?? '', /^\d{4}-/);
    secondItemVersion = completedBody.item.version;
    listVersion = completedBody.listVersion;

    const restored = await request(baseUrl, `/api/v1/shopping-lists/${listId}/items/${secondItem.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ completed: false, version: secondItemVersion }),
    });
    const restoredBody = await json<{ item: { completed: boolean; completedAt?: string; version: number }; listVersion: number }>(restored);
    assert.equal(restoredBody.item.completed, false);
    assert.equal('completedAt' in restoredBody.item, false);
    secondItemVersion = restoredBody.item.version;
    listVersion = restoredBody.listVersion;

    const reordered = await request(baseUrl, `/api/v1/shopping-lists/${listId}/items/order`, {
      method: 'PUT',
      body: JSON.stringify({ itemIds: [secondItem.id, firstItem.id], listVersion }),
    });
    const reorderedBody = await json<{ list: { version: number }; items: Array<{ id: string; position: number }> }>(reordered);
    assert.deepEqual(reorderedBody.items.map((item) => [item.id, item.position]), [[secondItem.id, 0], [firstItem.id, 1]]);
    listVersion = reorderedBody.list.version;

    const invalidOrder = await request(baseUrl, `/api/v1/shopping-lists/${listId}/items/order`, {
      method: 'PUT',
      body: JSON.stringify({ itemIds: [firstItem.id], listVersion }),
    });
    assert.equal(invalidOrder.status, 400);

    const deletedItem = await request(baseUrl, `/api/v1/shopping-lists/${listId}/items/${secondItem.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ version: secondItemVersion }),
    });
    assert.equal(deletedItem.status, 204);
    const loaded = await request(baseUrl, `/api/v1/shopping-lists/${listId}`);
    const loadedList = await json<{ list: { version: number }; items: Array<{ id: string; position: number }> }>(loaded);
    assert.deepEqual(loadedList.items.map((item) => [item.id, item.position]), [[firstItem.id, 0]]);
    listVersion = loadedList.list.version;
    assert.equal((await request(baseUrl, '/api/v1/shopping-lists/missing')).status, 404);

    const invalidJson = await request(baseUrl, '/api/v1/shopping-lists', { method: 'POST', body: '{' });
    assert.equal(invalidJson.status, 400);
    const oversized = await request(baseUrl, '/api/v1/shopping-lists', { method: 'POST', body: JSON.stringify({ name: 'x'.repeat(20_000) }) });
    assert.equal(oversized.status, 413);

    const uploaded = await request(baseUrl, '/api/v1/files', { method: 'POST', body: JSON.stringify({ base64: pngBase64, mimeType: 'image/png', originalName: 'receipt.png' }) });
    assert.equal(uploaded.status, 201);
    const storageKey = (await json<{ file: { storageKey: string } }>(uploaded)).file.storageKey;
    const preview = await request(baseUrl, `/api/v1/files/${storageKey}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('content-type'), 'image/png');
    assert.match(preview.headers.get('cache-control') ?? '', /no-store/);
    assert.deepEqual(new Uint8Array(await preview.arrayBuffer()), pngBytes);
    assert.equal((await request(baseUrl, '/api/v1/files/%2e%2e%2fsecret.png')).status, 400);
    assert.equal((await request(baseUrl, `/api/v1/files/${'a'.repeat(64)}.png`)).status, 404);

    const uploadedPdf = await request(baseUrl, '/api/v1/files', { method: 'POST', body: JSON.stringify({ base64: pdfBase64, mimeType: 'application/pdf', originalName: 'receipt.pdf' }) });
    assert.equal(uploadedPdf.status, 201);
    const pdfKey = (await json<{ file: { storageKey: string } }>(uploadedPdf)).file.storageKey;
    assert.equal((await request(baseUrl, `/api/v1/files/${pdfKey}`)).status, 400);

    const extracted = await request(baseUrl, '/api/v1/receipts/extract', { method: 'POST', body: JSON.stringify({ captures: [{ storageKey, originalName: 'receipt.png', embeddedText: 'Leche;1;120;120\nTOTAL 1,20' }], verifyWithAi: false }) });
    assert.equal(extracted.status, 200);
    const extraction = (await json<{ extraction: { pages: Array<{ source: string }>; final: { declaredTotalMinor: number; review: { lines: Array<{ status: string }> } } } }>(extracted)).extraction;
    assert.equal(extraction.pages[0]?.source, 'embedded-text');
    assert.equal(extraction.final.declaredTotalMinor, 120);
    assert.equal(extraction.final.review.lines[0]?.status, 'confirmed');

    const receipt = await request(baseUrl, '/api/v1/receipts/validate', { method: 'POST', body: JSON.stringify({ declaredTotalMinor: 120, items: [{ description: 'Leche', quantity: 1, unitPriceMinor: 120, lineTotalMinor: 120 }] }) });
    assert.equal((await json<{ total: { valid: boolean } }>(receipt)).total.valid, true);
    const mismatch = await request(baseUrl, '/api/v1/receipts/confirm', { method: 'POST', body: JSON.stringify({ importKey: 'receipt-0001', originalText: 'Leche', declaredTotalMinor: 100, items: [{ description: 'Leche', quantity: 1, unitPriceMinor: 120, lineTotalMinor: 120 }] }) });
    assert.equal(mismatch.status, 409);
    const confirmed = await request(baseUrl, '/api/v1/receipts/confirm', { method: 'POST', body: JSON.stringify({ importKey: 'receipt-0001', originalText: 'Leche', declaredTotalMinor: 120, captures: [{ storageKey, mimeType: 'image/png', originalName: 'receipt.png' }], items: [{ description: 'Leche', quantity: 1, unitPriceMinor: 120, lineTotalMinor: 120 }] }) });
    assert.equal(confirmed.status, 201);

    const now = new Date().toISOString();
    const optimized = await request(baseUrl, '/api/v1/optimization-runs', { method: 'POST', body: JSON.stringify({ requirements: [{ itemId: 'milk', label: 'Milk', exactRequired: true, substitutionAllowed: false }], offers: [{ id: 'offer', itemId: 'milk', retailerId: 'shop', title: 'Milk', priceMinor: 100, shippingMinor: 50, quantity: { amount: { numerator: 1, denominator: 1 }, unit: 'l' }, stock: 'in-stock', observedAt: now, confidence: 1, evidence: 'fixture', exact: true, substitutionQuality: 1, primeEligible: true, primeFreeDeliveryEvidence: true }], retailerPenaltyMinor: 0 }) });
    const plans = (await json<{ plans: Array<{ shippingMinor: number }> }>(optimized)).plans;
    assert.equal(plans[0]?.shippingMinor, 0);

    const backup = await request(baseUrl, '/api/v1/backup', { method: 'POST', body: JSON.stringify({ name: 'integration.db' }) });
    assert.equal(backup.status, 201);
    const restore = await request(baseUrl, '/api/v1/restore/validate', { method: 'POST', body: JSON.stringify({ name: 'integration.db' }) });
    assert.equal((await json<{ validation: { valid: boolean } }>(restore)).validation.valid, true);

    const html = await request(baseUrl, '/');
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    assert.match(await html.text(), /Basketra/);
    for (const module of ['/api.js', '/state.js', '/lists.js', '/receipts.js', '/ui.js']) {
      const response = await request(baseUrl, module);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /text\/javascript/);
    }
    assert.equal((await request(baseUrl, '/does-not-exist')).status, 404);

    const deletedList = await request(baseUrl, `/api/v1/shopping-lists/${listId}`, {
      method: 'DELETE',
      body: JSON.stringify({ version: listVersion }),
    });
    assert.equal(deletedList.status, 204);
    assert.equal((await request(baseUrl, `/api/v1/shopping-lists/${listId}`)).status, 404);

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(server.diagnostics().hibernated, true);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
