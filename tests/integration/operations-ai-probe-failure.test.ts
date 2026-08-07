import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
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
    overpassBaseUrl: 'http://127.0.0.1:9/api/',
    idleHibernateAfterMs: 0,
    idleExitAfterMs: 0,
  };
}

async function postJson(url: URL): Promise<Readonly<{ status: number; body: { connection: Record<string, unknown> } }>> {
  return await new Promise((resolvePromise, reject) => {
    const request = httpRequest(url, { method: 'POST', agent: false }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.once('error', reject);
      response.once('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
          assert.equal(typeof parsed, 'object');
          assert.notEqual(parsed, null);
          assert.equal(Array.isArray(parsed), false);
          const connection = (parsed as Record<string, unknown>)['connection'];
          assert.equal(typeof connection, 'object');
          assert.notEqual(connection, null);
          assert.equal(Array.isArray(connection), false);
          resolvePromise({
            status: response.statusCode ?? 0,
            body: { connection: connection as Record<string, unknown> },
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once('error', reject);
    request.end();
  });
}

test('operations gateway returns a redacted stable failure when the real capability probe is rejected', async () => {
  const directory = `.test-tmp/gateway-ai-probe-failure-${randomUUID()}`;
  let authorization: string | undefined;
  const providerServer = createServer((request, response) => {
    authorization = request.headers.authorization;
    response.writeHead(401, {
      'content-type': 'application/json',
      connection: 'close',
    });
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

  let gateway: OperationsGateway | undefined;
  try {
    gateway = new OperationsGateway(config(directory, (providerServer.address() as AddressInfo).port));
    await gateway.listen();
    const response = await postJson(new URL('/api/v1/settings/ai-provider/test', `http://127.0.0.1:${gateway.address().port}`));

    assert.equal(response.status, 502);
    assert.equal(authorization, undefined);
    assert.deepEqual(response.body.connection, {
      ok: false,
      code: 'AI_AUTHENTICATION_FAILED',
      status: 502,
      message: 'El proveedor de IA rechazó sus credenciales',
    });
    assert.doesNotMatch(JSON.stringify(response.body), /private_upstream_code|receipt text|credentials|private paths/u);
  } finally {
    if (gateway) await gateway.close();
    await new Promise<void>((resolve, reject) => providerServer.close(error => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
