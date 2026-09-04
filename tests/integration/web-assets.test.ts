import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

function shellAssets(): string[] {
  const serviceWorker = readFileSync('src/web/sw.js', 'utf8');
  const shell = /const SHELL = \[([\s\S]*?)\];/u.exec(serviceWorker)?.[1];
  assert.ok(shell, 'service worker must declare its shell asset list');
  return [...shell.matchAll(/'([^']+)'/gu)].map(match => match[1]);
}

function expectedContentType(asset: string): RegExp {
  const extension = extname(asset);
  if (asset === '/' || extension === '.html') return /text\/html/u;
  if (extension === '.js') return /text\/javascript/u;
  if (extension === '.css') return /text\/css/u;
  if (extension === '.svg') return /image\/svg\+xml/u;
  if (extension === '.webmanifest') return /application\/manifest\+json/u;
  return /application\/octet-stream/u;
}

test('server exposes every service-worker shell asset through the explicit static allowlist', async () => {
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
    const assets = shellAssets();
    assert.ok(assets.includes('/receipt-ai-recovery.js'));
    assert.ok(assets.includes('/receipt-review.css'));

    for (const asset of assets) {
      const response = await fetch(`${baseUrl}${asset}`);
      assert.equal(response.status, 200, `${asset} must be served`);
      assert.match(response.headers.get('content-type') ?? '', expectedContentType(asset));
    }

    for (const applicationPath of [
      '/lists/list_1',
      '/inventory/products/product_1?q=milk&page=2',
      '/inventory/categories/category_1?view=roots',
      '/inventory/stores/store_1?sort=recent',
      '/inventory/statistics?period=90d',
      '/tickets/history/ticket_1?status=paid',
      '/settings?tab=ai',
    ]) {
      const response = await fetch(`${baseUrl}${applicationPath}`);
      assert.equal(response.status, 200, `${applicationPath} must serve the application shell`);
      assert.match(response.headers.get('content-type') ?? '', /text\/html/u);
      assert.match(await response.text(), /id="main"/u);
    }

    const rejected = await fetch(`${baseUrl}/../src/api/server.ts`);
    assert.equal(rejected.status, 404);

    const unknownApplicationPath = await fetch(`${baseUrl}/inventory/products/a/b`);
    assert.equal(unknownApplicationPath.status, 404);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
