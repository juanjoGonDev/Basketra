import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import type { AppConfig } from '../../src/infrastructure/config.ts';
import { OperationsGateway } from '../../src/operations/gateway.ts';

const TEST_API_KEY = 'abc';
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function config(dataDir: string): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir,
    tempDir: `${dataDir}/tmp`,
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

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function updateRuntimeAi(
  baseUrl: string,
  aiBaseUrl: string,
  options: Readonly<{ apiKey?: string; model?: string }> = {},
): Promise<void> {
  const apiKey = options.apiKey === undefined ? TEST_API_KEY : options.apiKey;
  const response = await fetch(`${baseUrl}/api/v1/settings/runtime`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      aiBaseUrl,
      aiModel: options.model ?? 'default',
      aiApiKey: apiKey || null,
      aiMaxRetries: 0,
    }),
  });
  assert.equal(response.status, 200);
}

async function assertErrorEnvelope(
  response: Response,
  expected: Readonly<{ code: string; message: string }>,
): Promise<void> {
  const body = await response.json() as {
    error: { code: string; message: string; requestId: string };
  };
  assert.equal(body.error.code, expected.code);
  assert.equal(body.error.message, expected.message);
  assert.match(body.error.requestId, REQUEST_ID_PATTERN);
}

test('AI capability preflight resolves WebAPI limits on every request', async () => {
  const directory = `.test-tmp/ai-capabilities-${randomUUID()}`;
  let maxImageBytes = 8 * 1024 * 1024;
  const authorizations: Array<string | undefined> = [];
  let capabilityReads = 0;
  const webApi = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/v1/capabilities') {
      capabilityReads += 1;
      authorizations.push(request.headers.authorization);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(capabilityBody(maxImageBytes));
      return;
    }
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({ image: { format: 'jpg', text: 'BASKETRA OCR 4821' } }),
          },
        }],
      }));
      return;
    }
    response.writeHead(404).end();
  });
  const webApiPort = await listen(webApi);
  const gateway = new OperationsGateway(config(directory));

  try {
    await gateway.listen();
    const baseUrl = `http://127.0.0.1:${gateway.address().port}`;
    await updateRuntimeAi(baseUrl, `http://127.0.0.1:${webApiPort}/v1/`);

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
      `Bearer ${TEST_API_KEY}`,
      `Bearer ${TEST_API_KEY}`,
    ]);
  } finally {
    await gateway.close();
    await closeServer(webApi);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('AI capability preflight reports an unconfigured provider without an upstream request', async () => {
  const directory = `.test-tmp/ai-capabilities-unconfigured-${randomUUID()}`;
  const gateway = new OperationsGateway(config(directory));

  try {
    await gateway.listen();
    const response = await fetch(
      `http://127.0.0.1:${gateway.address().port}/api/v1/ai/runtime-capabilities`,
    );
    assert.equal(response.status, 503);
    await assertErrorEnvelope(response, {
      code: 'AI_NOT_CONFIGURED',
      message: 'El proveedor de IA no está configurado',
    });
  } finally {
    await gateway.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('container runtime rejects a loopback WebAPI configuration before provider traffic', async () => {
  const directory = `.test-tmp/ai-capabilities-container-loopback-${randomUUID()}`;
  const gateway = new OperationsGateway(config(directory));
  const mutableFs = createRequire(import.meta.url)('node:fs') as {
    existsSync: typeof import('node:fs').existsSync;
  };
  const originalExistsSync = mutableFs.existsSync;
  mutableFs.existsSync = (path) => path === '/.dockerenv' ? true : originalExistsSync(path);
  syncBuiltinESMExports();

  try {
    await gateway.listen();
    const baseUrl = `http://127.0.0.1:${gateway.address().port}`;
    await updateRuntimeAi(baseUrl, 'http://127.0.0.1:9/v1/');

    const settingsResponse = await fetch(`${baseUrl}/api/v1/settings/ai-provider`);
    assert.equal(settingsResponse.status, 200);
    const settings = await settingsResponse.json() as {
      configured: boolean;
      status: string;
      loopbackWarning: boolean;
    };
    assert.equal(settings.configured, true);
    assert.equal(settings.status, 'warning');
    assert.equal(settings.loopbackWarning, true);

    const probeResponse = await fetch(`${baseUrl}/api/v1/settings/ai-provider/test`, { method: 'POST' });
    assert.equal(probeResponse.status, 502);
    const probe = await probeResponse.json() as {
      connection: { ok: boolean; code: string; status: number; message: string };
    };
    assert.equal(probe.connection.ok, false);
    assert.equal(probe.connection.code, 'AI_LOOPBACK_CONTAINER');
    assert.equal(probe.connection.status, 502);
    assert.match(probe.connection.message, /host\.docker\.internal/u);
  } finally {
    mutableFs.existsSync = originalExistsSync;
    syncBuiltinESMExports();
    await gateway.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('AI capability preflight maps an unsupported capabilities endpoint without inventing limits', async () => {
  const directory = `.test-tmp/ai-capabilities-unsupported-${randomUUID()}`;
  const authorizations: Array<string | undefined> = [];
  const webApi = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/v1/capabilities') {
      authorizations.push(request.headers.authorization);
      response.writeHead(404).end();
      return;
    }
    response.writeHead(503).end();
  });
  const webApiPort = await listen(webApi);
  const gateway = new OperationsGateway(config(directory));

  try {
    await gateway.listen();
    const baseUrl = `http://127.0.0.1:${gateway.address().port}`;
    await updateRuntimeAi(baseUrl, `http://127.0.0.1:${webApiPort}/v1/`, { apiKey: '' });
    const response = await fetch(`${baseUrl}/api/v1/ai/runtime-capabilities`);
    assert.equal(response.status, 502);
    await assertErrorEnvelope(response, {
      code: 'AI_CAPABILITIES_UNAVAILABLE',
      message: 'WebAPI no expone los límites dinámicos requeridos',
    });
    assert.equal(authorizations.at(-1), undefined);
  } finally {
    await gateway.close();
    await closeServer(webApi);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('AI capability preflight maps upstream authentication failures', async () => {
  const directory = `.test-tmp/ai-capabilities-auth-${randomUUID()}`;
  const webApi = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/v1/capabilities') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'authentication_failed' } }));
      return;
    }
    response.writeHead(503).end();
  });
  const webApiPort = await listen(webApi);
  const gateway = new OperationsGateway(config(directory));

  try {
    await gateway.listen();
    const baseUrl = `http://127.0.0.1:${gateway.address().port}`;
    await updateRuntimeAi(baseUrl, `http://127.0.0.1:${webApiPort}/v1/`);
    const response = await fetch(`${baseUrl}/api/v1/ai/runtime-capabilities`);
    assert.equal(response.status, 502);
    await assertErrorEnvelope(response, {
      code: 'AI_AUTHENTICATION_FAILED',
      message: 'El proveedor de IA rechazó sus credenciales',
    });
  } finally {
    await gateway.close();
    await closeServer(webApi);
    rmSync(directory, { recursive: true, force: true });
  }
});
