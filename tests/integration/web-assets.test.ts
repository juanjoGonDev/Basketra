import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

const modularReceiptAssets = [
  '/receipt-state.js',
  '/receipt-capture.js',
  '/receipt-lifecycle.js',
  '/receipt-processing.js',
  '/receipt-review.js',
] as const;

test('server exposes the modular receipt shell with explicit safe static assets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-web-assets-'));
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
    idleHibernateAfterMs: 10,
    idleExitAfterMs: 0,
  };
  const server = new BasketraServer(config);
  await server.listen();
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    for (const asset of modularReceiptAssets) {
      const response = await fetch(`${baseUrl}${asset}`);
      assert.equal(response.status, 200, `${asset} must be served`);
      assert.match(response.headers.get('content-type') ?? '', /text\/javascript/u);
      assert.match(await response.text(), /export|import/u);
    }

    const stylesheet = await fetch(`${baseUrl}/receipt-review.css`);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get('content-type') ?? '', /text\/css/u);
    assert.match(await stylesheet.text(), /receipt-review-panel/u);

    const rejected = await fetch(`${baseUrl}/../src/api/server.ts`);
    assert.equal(rejected.status, 404);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
