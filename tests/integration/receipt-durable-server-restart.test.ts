import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);

const interpretation = {
  retailerName: 'ALCAMPO',
  declaredTotalMinor: 120,
  currency: 'EUR',
  correctedText: 'ALCAMPO\nTOTAL 1,20',
  items: [],
  warnings: [],
};

type RemoteFixture = Readonly<{
  server: Server;
  baseUrl: string;
  counts: { creates: number; gets: number };
  waitForFirstGet: () => Promise<void>;
  allowCompletion: () => void;
}>;

async function createRemoteFixture(): Promise<RemoteFixture> {
  const counts = { creates: 0, gets: 0 };
  let complete = false;
  let firstGetResolve!: () => void;
  const firstGet = new Promise<void>((resolve) => {
    firstGetResolve = resolve;
  });
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.method === 'POST' && request.url === '/v1/responses') {
      counts.creates += 1;
      response.end(JSON.stringify({
        id: 'resp_1234567',
        object: 'response',
        status: 'queued',
        background: true,
        output: [],
        error: null,
      }));
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/responses/resp_1234567') {
      counts.gets += 1;
      firstGetResolve();
      if (!complete) {
        request.once('close', () => {
          if (!response.writableEnded) response.end();
        });
        return;
      }
      response.end(JSON.stringify({
        id: 'resp_1234567',
        object: 'response',
        status: 'completed',
        background: true,
        error: null,
        output: [{
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{
            type: 'output_text',
            text: JSON.stringify(interpretation),
            annotations: [],
          }],
        }],
      }));
      return;
    }
    response.writeHead(404);
    response.end('{}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1/`,
    counts,
    waitForFirstGet: async () => await firstGet,
    allowCompletion: () => {
      complete = true;
    },
  };
}

function appConfig(root: string): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir: join(root, 'data'),
    tempDir: join(root, 'tmp'),
  };
}

async function configureProvider(baseUrl: string, aiBaseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/settings/runtime`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      aiBaseUrl,
      aiModel: 'default',
      aiApiKey: null,
      aiMaxRetries: 0,
    }),
  });
  assert.equal(response.status, 200);
}

async function uploadReceipt(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      base64: validPng.toString('base64'),
      mimeType: 'image/png',
      originalName: 'ticket.png',
    }),
  });
  const body = await response.json() as { file: { storageKey: string } };
  assert.equal(response.status, 201);
  return body.file.storageKey;
}

async function createExtractionJob(baseUrl: string, storageKey: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/receipts/extraction-jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      captures: [{
        storageKey,
        originalName: 'ticket.png',
        embeddedText: 'ALCAMPO\nTOTAL 1,20',
      }],
      verifyWithAi: true,
    }),
  });
  const body = await response.json() as { job: { id: string } };
  assert.equal(response.status, 202);
  return body.job.id;
}

async function waitForTerminalJob(baseUrl: string, jobId: string): Promise<Readonly<Record<string, unknown>>> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/v1/receipts/extraction-jobs/${jobId}`);
    assert.equal(response.status, 200);
    const body = await response.json() as { job: Readonly<Record<string, unknown>> };
    if (body.job['status'] === 'completed' || body.job['status'] === 'failed') return body.job;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Receipt extraction job did not reach a terminal state');
}

test('server restart preserves the durable response and resumes with GET only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-server-restart-'));
  const remote = await createRemoteFixture();
  const config = appConfig(root);
  let firstServer: BasketraServer | undefined;
  let secondServer: BasketraServer | undefined;

  try {
    firstServer = new BasketraServer(config);
    await firstServer.listen();
    const firstBaseUrl = `http://127.0.0.1:${firstServer.address().port}`;
    await configureProvider(firstBaseUrl, remote.baseUrl);
    const storageKey = await uploadReceipt(firstBaseUrl);
    const jobId = await createExtractionJob(firstBaseUrl, storageKey);

    await remote.waitForFirstGet();
    assert.equal(remote.counts.creates, 1);
    assert.equal(remote.counts.gets, 1);

    await firstServer.close();
    firstServer = undefined;
    remote.allowCompletion();

    secondServer = new BasketraServer(config);
    await secondServer.listen();
    const secondBaseUrl = `http://127.0.0.1:${secondServer.address().port}`;
    const persistedSettings = await fetch(`${secondBaseUrl}/api/v1/settings/runtime`);
    assert.equal(persistedSettings.status, 200);
    const settingsBody = await persistedSettings.json() as { settings: { ai: { baseUrl?: string; model?: string } } };
    assert.equal(settingsBody.settings.ai.baseUrl, remote.baseUrl);
    assert.equal(settingsBody.settings.ai.model, 'default');

    const job = await waitForTerminalJob(secondBaseUrl, jobId);

    assert.equal(job['status'], 'completed');
    assert.equal(remote.counts.creates, 1);
    assert.equal(remote.counts.gets, 2);
    const extraction = job['extraction'] as { final?: { retailerName?: string } } | undefined;
    assert.equal(extraction?.final?.retailerName, 'ALCAMPO');
  } finally {
    if (firstServer) await firstServer.close();
    if (secondServer) await secondServer.close();
    await new Promise<void>((resolve, reject) => remote.server.close((error) => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
