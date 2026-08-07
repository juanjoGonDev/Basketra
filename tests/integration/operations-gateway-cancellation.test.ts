import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import type { AppConfig } from '../../src/infrastructure/config.ts';
import { OperationsGateway } from '../../src/operations/gateway.ts';

function config(dataDir: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir,
    tempDir: `${dataDir}/tmp`,
    maxBodyBytes: 8 * 1024 * 1024,
    aiMaxRetries: 0,
    aiImageCapability: true,
    aiPdfCapability: false,
    idleHibernateAfterMs: 0,
    idleExitAfterMs: 0,
    ...overrides,
  };
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(label)), 2_000);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

test('operations gateway cancels the provider probe when its inbound request is aborted', async () => {
  const directory = `.test-tmp/gateway-ai-abort-${randomUUID()}`;
  let markProviderStarted: (() => void) | undefined;
  let markProviderClosed: (() => void) | undefined;
  const providerStarted = new Promise<void>((resolve) => { markProviderStarted = resolve; });
  const providerClosed = new Promise<void>((resolve) => { markProviderClosed = resolve; });
  const providerServer = createServer((_providerRequest, providerResponse) => {
    markProviderStarted?.();
    providerResponse.once('close', () => markProviderClosed?.());
  });

  await new Promise<void>((resolve, reject) => {
    providerServer.once('error', reject);
    providerServer.listen(0, '0.0.0.0', () => {
      providerServer.off('error', reject);
      resolve();
    });
  });

  const providerPort = (providerServer.address() as AddressInfo).port;
  const gateway = new OperationsGateway(config(directory, {
    aiBaseUrl: `http://127.0.0.2:${providerPort}/v1/`,
    aiModel: 'gpt-5',
  }));

  try {
    await gateway.listen();
    const clientRequest = request({
      host: '127.0.0.1',
      port: gateway.address().port,
      path: '/api/v1/settings/ai-provider/test',
      method: 'POST',
      headers: { 'content-length': '1' },
    });
    clientRequest.on('error', () => {});
    clientRequest.flushHeaders();

    await bounded(providerStarted, 'provider probe did not start');
    clientRequest.destroy();
    await bounded(providerClosed, 'provider probe was not cancelled after the inbound request aborted');
    assert.equal(clientRequest.destroyed, true);
  } finally {
    await gateway.close();
    await new Promise<void>((resolve, reject) => providerServer.close(error => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
