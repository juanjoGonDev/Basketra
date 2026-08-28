import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

async function request(baseUrl: string, path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function uploadPng(baseUrl: string, bytes: readonly number[], name: string): Promise<string> {
  const response = await request(baseUrl, '/api/v1/files', {
    method: 'POST',
    body: JSON.stringify({
      base64: Buffer.from(Uint8Array.from(bytes)).toString('base64'),
      mimeType: 'image/png',
      originalName: name,
    }),
  });
  assert.equal(response.status, 201);
  return (await json<{ file: { storageKey: string } }>(response)).file.storageKey;
}

test('receipt recovery adopts only the durable job with the exact ordered capture identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-receipt-recover-api-'));
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
    idleHibernateAfterMs: 0,
    idleExitAfterMs: 0,
  };
  const server = new BasketraServer(config);
  await server.listen();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const firstStorageKey = await uploadPng(baseUrl, [0x89, 0x50, 0x4e, 0x47, 0x01], 'first.png');
    const secondStorageKey = await uploadPng(baseUrl, [0x89, 0x50, 0x4e, 0x47, 0x02], 'second.png');
    const captures = [
      { storageKey: firstStorageKey, originalName: 'first.png', embeddedText: 'PAN 1,00\nTOTAL 1,00' },
      { storageKey: secondStorageKey, originalName: 'second.png', embeddedText: 'LECHE 2,00\nTOTAL 2,00' },
    ];

    const created = await request(baseUrl, '/api/v1/receipts/extraction-jobs', {
      method: 'POST',
      body: JSON.stringify({ captures, verifyWithAi: true }),
    });
    assert.equal(created.status, 202);
    const createdJob = (await json<{ job: { id: string } }>(created)).job;

    const recovered = await request(baseUrl, '/api/v1/receipts/extraction-jobs/recover', {
      method: 'POST',
      body: JSON.stringify({ captures }),
    });
    assert.equal(recovered.status, 200);
    assert.deepEqual(await json(recovered), {
      job: {
        id: createdJob.id,
        status: assert.match,
      },
    });
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
