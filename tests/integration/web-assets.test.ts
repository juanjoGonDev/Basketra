import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

/**
 * A browser ES module graph is all-or-nothing: one unserved local import stops every module in the
 * graph from evaluating, so a single missing allowlist entry silently disables the whole interface.
 */
const MODULE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\bimport\s+)['"](\.[^'"]+\.(?:js|css))['"]/gu;
const ENTRY_SCRIPT = /<script\b[^>]*\bsrc="\/([^"]+\.js)"[^>]*>/gu;

function shellAssets(): string[] {
  const serviceWorker = readFileSync('src/web/sw.js', 'utf8');
  const shell = /const SHELL = \[([\s\S]*?)\];/u.exec(serviceWorker)?.[1];
  assert.ok(shell, 'service worker must declare its shell asset list');
  return [...shell.matchAll(/'([^']+)'/gu)].map(match => match[1]);
}

function entryPointAssets(): string[] {
  const html = readFileSync('src/web/index.html', 'utf8');
  const entries = [...html.matchAll(ENTRY_SCRIPT)].map(match => match[1]);
  assert.ok(entries.includes('app.js'), 'index.html must load the application entry module');
  return entries;
}

function resolveSpecifier(importer: string, specifier: string): string {
  return normalize(join(dirname(importer), specifier)).split('\\').join('/');
}

function assetServerConfig(root: string): AppConfig {
  return {
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
  const server = new BasketraServer(assetServerConfig(root));
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

test('server serves and precaches every module reachable from the browser entry points', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-web-modules-'));
  const server = new BasketraServer(assetServerConfig(root));
  await server.listen();
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const shell = new Set(shellAssets());
    const reachable = new Set<string>();
    const queue = entryPointAssets();

    // Walk the graph through HTTP so the assertion covers what a browser actually receives,
    // not merely what exists on disk. An unserved import breaks every module in the graph.
    while (queue.length > 0) {
      const asset = queue.shift() as string;
      if (reachable.has(asset)) continue;
      reachable.add(asset);

      const response = await fetch(`${baseUrl}/${asset}`);
      assert.equal(response.status, 200, `/${asset} is imported by the browser module graph and must be served`);
      assert.match(response.headers.get('content-type') ?? '', expectedContentType(asset));
      if (extname(asset) !== '.js') continue;

      const source = await response.text();
      for (const match of source.matchAll(MODULE_SPECIFIER)) {
        queue.push(resolveSpecifier(asset, match[1]));
      }
    }

    assert.ok(reachable.size > 20, 'the entry points must reach the full application module graph');
    assert.ok(reachable.has('receipt-lifecycle.js'), 'receipt lifecycle must stay reachable from app.js');
    assert.ok(reachable.has('receipt-page-state.js'), 'receipt page state must stay reachable from receipt-state.js');

    for (const asset of reachable) {
      if (extname(asset) !== '.js') continue;
      assert.ok(shell.has(`/${asset}`), `/${asset} must be precached so the installed PWA can boot offline`);
    }
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
