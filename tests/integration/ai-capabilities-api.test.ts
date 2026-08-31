import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

function config(dataDir: string, aiBaseUrl: string): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir,
    tempDir: `${dataDir}/tmp`,
    maxBodyBytes: 8 * 1024 * 1024,
    aiBaseUrl,
    aiApiKey: 'test-capability-token',
    aiModel: 'default',
    aiMaxRetries: 0,
    aiImageCapability: true,
    aiPdfCapability: false,
    overpassBaseUrl: 'http://127.0.0.1:9/api/',
    idleHibernateAfterMs: 0,
    idleExitAfterMs: 0,
  };
}

function capabilityBody(maxImageBytes: number): string {
  return JSON.stringify({
    attachments: {
      maxCount: 10,
      maxFileBytes: 512 * 1024 * 1024,
      maxImageBytes,
      maxSpreadsheetBytes: 50 * 1024 * 1024,
      maxUploadsPerThreeHours: 80,
    },
    execution: { replyInactivityTimeoutMs: 120_000 },
    requests: { maxJsonBodyBytes: 500 * 1024 * 1024 },
  });
}

test('AI capability preflight resolves WebAPI limits on every request', async () => {
  const directory = `.test-tmp/ai-capabilities-${randomUUID()}`;
  let maxImageBytes = 8 * 1024 * 1024;
  const authorizations: Array<string | undefined> = [];
  let capabilityReads = 0;
  const webApi = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/v1/capabilities') {
      response.writeHead(404).end();
      return;
    }
    capabilityReads += 1;
    authorizations.push(request.headers.authorization);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(capabilityBody(maxImageBytes));
  });
  await new Promise<void>((resolve, reject) => {
    webApi.once('error', reject);
    webApi.listen(0, '127.0.0.1', () => {
      webApi.off('error', reject);
      resolve();
    });
  });
  const webApiPort = (webApi.address() as AddressInfo).port;
  const server = new BasketraServer(
    config(directory, `http://127.0.0.1:${webApiPort}/v1/`),
  );

  try {
    await server.listen();
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const first = await fetch(`${baseUrl}/api/v1/ai/runtime-capabilities`);
    assert.equal(first.status, 200);
    assert.equal(
      ((await first.json()) as { attachments: { maxImageBytes: number } }).attachments.maxImageBytes,
      8 * 1024 * 1024,
    );

    maxImageBytes = 12 * 1024 * 1024;
    const second = await fetch(`${baseUrl}/api/v1/ai/runtime-capabilities`);
    assert.equal(second.status, 200);
    assert.equal(
      ((await second.json()) as { attachments: { maxImageBytes: number } }).attachments.maxImageBytes,
      12 * 1024 * 1024,
    );

    assert.equal(capabilityReads, 2);
    assert.deepEqual(authorizations, [
      'Bearer test-capability-token',
      'Bearer test-capability-token',
    ]);
  } finally {
    await server.close();
    await new Promise<void>((resolve) => webApi.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
