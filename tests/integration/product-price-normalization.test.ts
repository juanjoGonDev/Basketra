import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

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

test('product price normalization returns server-owned display units', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-price-normalization-'));
  const server = new BasketraServer(createConfig(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/api/v1/products/price-normalization`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        priceMinor: 200,
        packageNumerator: 500,
        packageDenominator: 1,
        packageUnit: 'g',
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      normalizedPriceMinor: 400,
      normalizedPriceUnit: 'kg',
    });
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
