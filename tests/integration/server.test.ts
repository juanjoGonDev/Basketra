import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

async function request(baseUrl: string, path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, options);
}

test('HTTP API enforces auth, validates input and serves the PWA', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-api-'));
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 0,
    dataDir: join(root, 'data'),
    tempDir: join(root, 'tmp'),
    authToken: 'local-secret',
    maxBodyBytes: 16_384,
    aiTimeoutMs: 1_000,
    aiMaxRetries: 1,
    idleHibernateAfterMs: 10,
    idleExitAfterMs: 0,
  };
  const server = new BasketraServer(config);
  await server.listen();
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const authorized = { authorization: 'Bearer local-secret', 'content-type': 'application/json' };
  try {
    const health = await request(baseUrl, '/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json() as { status: string }).status, 'ok');
    assert.equal((await request(baseUrl, '/readiness')).status, 200);
    assert.equal((await request(baseUrl, '/api/v1/diagnostics')).status, 401);
    assert.equal((await request(baseUrl, '/api/v1/diagnostics', { headers: { authorization: 'Bearer wrong' } })).status, 401);
    const aiSettings = await request(baseUrl, '/api/v1/settings/ai-provider', { headers: authorized });
    assert.deepEqual(await aiSettings.json(), { configured: false });
    const aiUnavailable = await request(baseUrl, '/api/v1/ai/shopping-list-analysis', { method: 'POST', headers: authorized, body: JSON.stringify({ text: 'milk and rice' }) });
    assert.equal(aiUnavailable.status, 503);

    const created = await request(baseUrl, '/api/v1/shopping-lists', { method: 'POST', headers: authorized, body: JSON.stringify({ name: 'Semanal' }) });
    assert.equal(created.status, 201);
    const listId = (await created.json() as { list: { id: string } }).list.id;
    const added = await request(baseUrl, `/api/v1/shopping-lists/${listId}/items`, { method: 'POST', headers: authorized, body: JSON.stringify({ text: 'Leche', quantityMinor: 2, unit: 'l', exactRequired: true, substitutionAllowed: false }) });
    assert.equal(added.status, 201);
    const loaded = await request(baseUrl, `/api/v1/shopping-lists/${listId}`, { headers: authorized });
    assert.equal((await loaded.json() as { items: unknown[] }).items.length, 1);
    assert.equal((await request(baseUrl, '/api/v1/shopping-lists/missing', { headers: authorized })).status, 404);

    const invalidJson = await request(baseUrl, '/api/v1/shopping-lists', { method: 'POST', headers: authorized, body: '{' });
    assert.equal(invalidJson.status, 400);
    const oversized = await request(baseUrl, '/api/v1/shopping-lists', { method: 'POST', headers: authorized, body: JSON.stringify({ name: 'x'.repeat(20_000) }) });
    assert.equal(oversized.status, 413);

    const receipt = await request(baseUrl, '/api/v1/receipts/validate', { method: 'POST', headers: authorized, body: JSON.stringify({ declaredTotalMinor: 120, items: [{ description: 'Leche', quantity: 1, unitPriceMinor: 120, lineTotalMinor: 120 }] }) });
    assert.equal((await receipt.json() as { total: { valid: boolean } }).total.valid, true);
    const mismatch = await request(baseUrl, '/api/v1/receipts/confirm', { method: 'POST', headers: authorized, body: JSON.stringify({ importKey: 'receipt-0001', originalText: 'Leche', declaredTotalMinor: 100, items: [{ description: 'Leche', quantity: 1, unitPriceMinor: 120, lineTotalMinor: 120 }] }) });
    assert.equal(mismatch.status, 409);
    const confirmed = await request(baseUrl, '/api/v1/receipts/confirm', { method: 'POST', headers: authorized, body: JSON.stringify({ importKey: 'receipt-0001', originalText: 'Leche', declaredTotalMinor: 120, items: [{ description: 'Leche', quantity: 1, unitPriceMinor: 120, lineTotalMinor: 120 }] }) });
    assert.equal(confirmed.status, 201);

    const now = new Date().toISOString();
    const optimized = await request(baseUrl, '/api/v1/optimization-runs', { method: 'POST', headers: authorized, body: JSON.stringify({ requirements: [{ itemId: 'milk', label: 'Milk', exactRequired: true, substitutionAllowed: false }], offers: [{ id: 'offer', itemId: 'milk', retailerId: 'shop', title: 'Milk', priceMinor: 100, shippingMinor: 50, quantity: { amount: { numerator: 1, denominator: 1 }, unit: 'l' }, stock: 'in-stock', observedAt: now, confidence: 1, evidence: 'fixture', exact: true, substitutionQuality: 1, primeEligible: true, primeFreeDeliveryEvidence: true }], retailerPenaltyMinor: 0 }) });
    const plans = (await optimized.json() as { plans: Array<{ shippingMinor: number }> }).plans;
    assert.equal(plans[0]?.shippingMinor, 0);

    const backup = await request(baseUrl, '/api/v1/backup', { method: 'POST', headers: authorized, body: JSON.stringify({ name: 'integration.db' }) });
    assert.equal(backup.status, 201);
    const restore = await request(baseUrl, '/api/v1/restore/validate', { method: 'POST', headers: authorized, body: JSON.stringify({ name: 'integration.db' }) });
    assert.equal((await restore.json() as { validation: { valid: boolean } }).validation.valid, true);

    const html = await request(baseUrl, '/');
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    assert.match(await html.text(), /Basketra/);
    assert.equal((await request(baseUrl, '/does-not-exist', { headers: authorized })).status, 404);

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(server.diagnostics().hibernated, true);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
