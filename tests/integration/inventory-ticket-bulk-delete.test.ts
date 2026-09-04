import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { BasketraServer } from '../../src/api/server.ts';
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

async function importReceipt(baseUrl: string, key: string, description: string): Promise<string> {
  const response = await request(baseUrl, '/api/v1/receipts/confirm', 'POST', {
    importKey: key,
    declaredTotalMinor: 100,
    originalText: `${description} 1,00`,
    retailerName: 'Mercado',
    items: [{ description, quantity: 1, unitPriceMinor: 100, lineTotalMinor: 100 }],
  });
  assert.equal(response.status, 201);
  return String(response.body?.['receiptId']);
}

test('ticket bulk delete preflights and deletes explicit ids atomically', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-ticket-bulk-delete-'));
  const server = new BasketraServer(config(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const first = await importReceipt(baseUrl, 'bulk-delete-1', 'Leche');
    const second = await importReceipt(baseUrl, 'bulk-delete-2', 'Pan');

    const impact = await request(baseUrl, '/api/v1/inventory/tickets/bulk-delete-impact', 'POST', { ids: [first, second] });
    assert.equal(impact.status, 200);
    const impactRecord = record(impact.body?.['impact']);
    assert.equal(impactRecord['ticketCount'], 2);
    assert.equal(impactRecord['canDelete'], true);
    assert.ok(Number(impactRecord['externalEvidence']) >= 2);
    assert.ok(Number(impactRecord['retainedPriceObservations']) >= 2);

    const failed = await request(baseUrl, '/api/v1/inventory/tickets/bulk-delete', 'POST', { ids: [first, 'missing_ticket'] });
    assert.equal(failed.status, 404);
    assert.equal((await request(baseUrl, `/api/v1/inventory/tickets/${first}`)).status, 200);

    const deleted = await request(baseUrl, '/api/v1/inventory/tickets/bulk-delete', 'POST', { ids: [first, second] });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body?.['deletedIds'], [first, second]);
    assert.equal((await request(baseUrl, `/api/v1/inventory/tickets/${first}`)).status, 404);
    assert.equal((await request(baseUrl, `/api/v1/inventory/tickets/${second}`)).status, 404);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('ticket bulk delete rejects empty, duplicate-normalized and oversized selections safely', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-ticket-bulk-delete-validation-'));
  const server = new BasketraServer(config(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    assert.equal((await request(baseUrl, '/api/v1/inventory/tickets/bulk-delete-impact', 'POST', { ids: [] })).status, 400);
    const oversized = Array.from({ length: 101 }, (_, index) => `receipt_${index}`);
    assert.equal((await request(baseUrl, '/api/v1/inventory/tickets/bulk-delete', 'POST', { ids: oversized })).status, 400);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
