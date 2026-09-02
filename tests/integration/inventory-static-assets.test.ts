import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BasketraServer } from '../../src/api/server.ts';
import type { AppConfig } from '../../src/infrastructure/config.ts';

function config(root: string): AppConfig {
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

async function get(baseUrl: string, path: string): Promise<Readonly<{ status: number; contentType: string; body: string }>> {
  return await new Promise((resolvePromise, reject) => {
    const request = httpRequest(new URL(path, baseUrl), { method: 'GET', agent: false }, (response: IncomingMessage) => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.once('error', reject);
      response.once('end', () => resolvePromise({
        status: response.statusCode ?? 0,
        contentType: String(response.headers['content-type'] ?? ''),
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.once('error', reject);
    request.end();
  });
}

test('inventory feature assets are served through the canonical static allowlist', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-inventory-assets-'));
  const server = new BasketraServer(config(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const script = await get(baseUrl, '/inventory.js');
    assert.equal(script.status, 200);
    assert.match(script.contentType, /^text\/javascript\b/u);
    assert.match(script.body, /initializeInventoryFeature/u);

    const stylesheet = await get(baseUrl, '/inventory.css');
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.contentType, /^text\/css\b/u);
    assert.match(stylesheet.body, /inventory-store-grid/u);

    const unknown = await get(baseUrl, '/inventory-private.js');
    assert.equal(unknown.status, 404);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
