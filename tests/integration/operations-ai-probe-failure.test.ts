import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import type { AppConfig } from '../../src/infrastructure/config.ts';
import { OperationsGateway } from '../../src/operations/gateway.ts';

function config(dataDir: string, providerPort: number): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir,
    tempDir: `${dataDir}/tmp`,
    maxBodyBytes: 8 * 1024 * 1024,
    aiBaseUrl: `http://127.0.0.2:${providerPort}/v1/`,
    aiModel: 'test-model',
    aiTimeoutMs: 1_000,
    aiMaxRetries: 0,
    aiImageCapability: true,
    aiPdfCapability: false,
    idleHibernateAfterMs: 0,
    idleExitAfterMs: 0,
  };
}

test('operations gateway returns a redacted stable failure when the real capability probe is rejected', async () => {
  const directory = `.test-tmp/gateway-ai-probe-failure-${randomUUID()}`;
  let authorization: string | undefined;
  const providerServer = createServer((request, response) => {
    authorization = request.headers.authorization;
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      error: {
        code: 'private_upstream_code',
        message: 'receipt text, credentials and private paths must not escape',
      },
    }));
  });
  await new Promise<void>((resolve, reject) => {
    providerServer.once('error', reject);
    providerServer.listen(0, '0.0.0.0', () => {
      providerServer.off('error', reject);
      resolve();
    });
  });

  const gateway = new OperationsGateway(config(directory, (providerServer.address() as AddressInfo).port));
  try {
    await gateway.listen();
    const baseUrl = `http://127.0.0.1:${gateway.address().port}`;
    const response = await fetch(`${baseUrl}/api/v1/settings/ai-provider/test`, { method: 'POST' });
    const body = await response.json() as { connection: Record<string, unknown> };

    assert.equal(response.status, 502);
    assert.equal(authorization, undefined);
    assert.deepEqual(body.connection, {
      ok: false,
      code: 'AI_AUTHENTICATION_FAILED',
      status: 502,
      message: 'El proveedor de IA rechazó sus credenciales',
    });
    assert.doesNotMatch(JSON.stringify(body), /private_upstream_code|receipt text|credentials|private paths/u);
  } finally {
    await gateway.close();
    await new Promise<void>((resolve, reject) => providerServer.close(error => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
