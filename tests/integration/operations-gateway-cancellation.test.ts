import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer, request, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import type { AppConfig } from '../../src/infrastructure/config.ts';
import { OperationsGateway } from '../../src/operations/gateway.ts';

function config(dataDir: string): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir,
    tempDir: `${dataDir}/tmp`,
  };
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(label)), 2_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function realtimeClientCount(gateway: OperationsGateway): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const clientRequest = request({
      host: '127.0.0.1',
      port: gateway.address().port,
      path: '/api/v1/diagnostics',
      method: 'GET',
      agent: false,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.once('error', reject);
      response.once('end', () => {
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          assert.equal(typeof parsed, 'object');
          assert.notEqual(parsed, null);
          assert.equal(Array.isArray(parsed), false);
          const value = (parsed as Record<string, unknown>)['realtimeClients'];
          assert.equal(typeof value, 'number');
          resolve(value);
        } catch (error) {
          reject(error);
        }
      });
    });
    clientRequest.once('error', reject);
    clientRequest.end();
  });
}

async function waitForRealtimeClientCount(gateway: OperationsGateway, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await realtimeClientCount(gateway) === expected) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`realtime client count did not become ${expected}`);
}

async function openRealtime(gateway: OperationsGateway): Promise<Readonly<{ stream: IncomingMessage; close(): void }>> {
  return await new Promise((resolve, reject) => {
    const clientRequest = request({
      host: '127.0.0.1',
      port: gateway.address().port,
      path: '/api/v1/realtime',
      method: 'GET',
      agent: false,
    }, (response) => {
      try {
        assert.equal(response.statusCode, 200);
        assert.match(String(response.headers['content-type'] ?? ''), /^text\/event-stream/u);
        resolve({
          stream: response,
          close() {
            response.destroy();
            clientRequest.destroy();
          },
        });
      } catch (error) {
        response.destroy();
        clientRequest.destroy();
        reject(error);
      }
    });
    clientRequest.once('error', reject);
    clientRequest.end();
  });
}

async function configureProvider(gateway: OperationsGateway, providerPort: number): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${gateway.address().port}/api/v1/settings/runtime`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      aiBaseUrl: `http://127.0.0.2:${providerPort}/v1/`,
      aiModel: 'gpt-5',
      aiApiKey: null,
      aiMaxRetries: 0,
    }),
  });
  assert.equal(response.status, 200);
}

test('operations gateway cancels the provider probe when its inbound request is aborted', async () => {
  const directory = `.test-tmp/gateway-ai-abort-${randomUUID()}`;
  let markProviderStarted: (() => void) | undefined;
  let markProviderClosed: (() => void) | undefined;
  const providerStarted = new Promise<void>((resolve) => { markProviderStarted = resolve; });
  const providerClosed = new Promise<void>((resolve) => { markProviderClosed = resolve; });
  const providerServer = createServer((providerRequest, providerResponse) => {
    providerRequest.resume();
    providerRequest.once('end', () => markProviderStarted?.());
    providerResponse.once('close', () => markProviderClosed?.());
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
    const providerPort = (providerServer.address() as AddressInfo).port;
    gateway = new OperationsGateway(config(directory));
    await gateway.listen();
    await configureProvider(gateway, providerPort);
    const clientRequest = request({
      host: '127.0.0.1',
      port: gateway.address().port,
      path: '/api/v1/settings/ai-provider/test',
      method: 'POST',
      headers: { 'content-length': '1' },
      agent: false,
    });
    clientRequest.on('error', () => {});
    clientRequest.flushHeaders();

    await bounded(providerStarted, 'provider probe did not finish uploading');
    clientRequest.destroy();
    await bounded(providerClosed, 'provider probe was not cancelled after the inbound request aborted');
    assert.equal(clientRequest.destroyed, true);
  } finally {
    if (gateway) await gateway.close();
    providerServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => providerServer.close(error => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('operations gateway tears down both proxy sides when a realtime client disconnects', async () => {
  const directory = `.test-tmp/gateway-realtime-abort-${randomUUID()}`;
  const gateway = new OperationsGateway(config(directory));
  let realtime: Readonly<{ stream: IncomingMessage; close(): void }> | undefined;

  try {
    await gateway.listen();
    assert.equal(await realtimeClientCount(gateway), 0);

    realtime = await bounded(openRealtime(gateway), 'realtime proxy did not open');
    await bounded(waitForRealtimeClientCount(gateway, 1), 'realtime client was not registered');

    realtime.close();
    await bounded(waitForRealtimeClientCount(gateway, 0), 'realtime proxy did not release the upstream client');
    assert.equal(realtime.stream.destroyed, true);
  } finally {
    realtime?.close();
    await gateway.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
