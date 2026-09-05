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

test('inventory and ticket-history feature assets are served through the canonical static allowlist', async () => {
  const root = mkdtempSync(join(tmpdir(), 'basketra-inventory-assets-'));
  const server = new BasketraServer(config(root));
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const inventoryScript = await get(baseUrl, '/inventory.js');
    assert.equal(inventoryScript.status, 200);
    assert.match(inventoryScript.contentType, /^text\/javascript\b/u);
    assert.match(inventoryScript.body, /initializeInventoryFeature/u);

    const inventoryStylesheet = await get(baseUrl, '/inventory.css');
    assert.equal(inventoryStylesheet.status, 200);
    assert.match(inventoryStylesheet.contentType, /^text\/css\b/u);
    assert.match(inventoryStylesheet.body, /inventory-store-grid/u);

    const inventorySwipe = await get(baseUrl, '/inventory-swipe.js');
    assert.equal(inventorySwipe.status, 200);
    assert.match(inventorySwipe.contentType, /^text\/javascript\b/u);
    assert.match(inventorySwipe.body, /initializeInventorySwipeEnhancement/u);

    const inventorySwipeStylesheet = await get(baseUrl, '/inventory-swipe.css');
    assert.equal(inventorySwipeStylesheet.status, 200);
    assert.match(inventorySwipeStylesheet.contentType, /^text\/css\b/u);
    assert.match(inventorySwipeStylesheet.body, /inventory-entity-swipe/u);

    const index = await get(baseUrl, '/');
    assert.equal(index.status, 200);
    assert.match(index.body, /src="\/inventory-swipe\.js"/u);

    const ticketScript = await get(baseUrl, '/ticket-history.js');
    assert.equal(ticketScript.status, 200);
    assert.match(ticketScript.contentType, /^text\/javascript\b/u);
    assert.match(ticketScript.body, /initializeTicketHistoryFeature/u);

    const ticketStylesheet = await get(baseUrl, '/ticket-history.css');
    assert.equal(ticketStylesheet.status, 200);
    assert.match(ticketStylesheet.contentType, /^text\/css\b/u);
    assert.match(ticketStylesheet.body, /ticket-history-grid/u);

    const ticketValues = await get(baseUrl, '/ticket-history-values.js');
    assert.equal(ticketValues.status, 200);
    assert.match(ticketValues.contentType, /^text\/javascript\b/u);
    assert.match(ticketValues.body, /parsePercentageBasisPoints/u);

    const routes = await get(baseUrl, '/routes.js');
    assert.equal(routes.status, 200);
    assert.match(routes.contentType, /^text\/javascript\b/u);
    assert.match(routes.body, /resolveApplicationRoute/u);

    const unknown = await get(baseUrl, '/inventory-private.js');
    assert.equal(unknown.status, 404);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
