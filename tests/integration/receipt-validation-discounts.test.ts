import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest, type IncomingMessage } from 'node:http';
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

async function postJson(baseUrl: string, path: string, body: unknown): Promise<Readonly<{ status: number; body: JsonObject }>> {
  const serializedBody = JSON.stringify(body);
  return await new Promise((resolvePromise, reject) => {
    const request = httpRequest(new URL(path, baseUrl), {
      method: 'POST',
      agent: false,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(serializedBody),
      },
    }, (response: IncomingMessage) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.once('error', reject);
      response.once('end', () => {
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolvePromise({ status: response.statusCode ?? 0, body: expectRecord(parsed) });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once('error', reject);
    request.end(serializedBody);
  });
}

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-validation-'));
  const server = new BasketraServer(createConfig(root));
  await server.listen();
  const address = server.address();
  try {
    await run(`http://${address.host}:${address.port}`);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test('receipt validation consumes typed percentage discounts at the HTTP boundary', async () => {
  await withServer(async (baseUrl) => {
    const response = await postJson(baseUrl, '/api/v1/receipts/validate', {
      items: [{
        description: 'BEBIDA COCO',
        quantity: 1,
        unitPriceMinor: 175,
        lineTotalMinor: 87,
        discount: { type: 'percentage', basisPoints: 5000 },
      }],
      declaredTotalMinor: 87,
    });

    assert.equal(response.status, 200);
    const line = expectRecord(expectArray(response.body['lines'])[0]);
    assert.deepEqual(line['discount'], { type: 'percentage', basisPoints: 5000 });
    assert.deepEqual(expectRecord(line['validation']), {
      status: 'confirmed',
      expectedMinor: 87,
      differenceMinor: 0,
    });
    assert.equal(expectRecord(response.body['total'])['valid'], true);
  });
});

test('receipt validation keeps legacy amount compatibility and rejects mixed discount representations', async () => {
  await withServer(async (baseUrl) => {
    const legacy = await postJson(baseUrl, '/api/v1/receipts/validate', {
      items: [{
        description: 'BEBIDA COCO',
        quantity: 1,
        unitPriceMinor: 175,
        lineTotalMinor: 150,
        discountMinor: 25,
      }],
      declaredTotalMinor: 150,
    });

    assert.equal(legacy.status, 200);
    const legacyLine = expectRecord(expectArray(legacy.body['lines'])[0]);
    assert.equal(expectRecord(legacyLine['validation'])['status'], 'confirmed');

    const mixed = await postJson(baseUrl, '/api/v1/receipts/validate', {
      items: [{
        description: 'BEBIDA COCO',
        quantity: 1,
        unitPriceMinor: 175,
        lineTotalMinor: 150,
        discount: { type: 'amount', amountMinor: 25 },
        discountMinor: 25,
      }],
      declaredTotalMinor: 150,
    });

    assert.equal(mixed.status, 400);
    assert.equal(expectRecord(mixed.body['error'])['code'], 'VALIDATION_ERROR');
  });
});
