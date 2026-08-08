import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { BasketraServer } from '../src/api/server.ts';

const PRODUCT_PROPOSAL = Object.freeze({
  canonicalName: 'Leche entera',
  variantName: 'Leche entera 1 L',
  brand: 'Marca Demo',
  ean: '8412345678901',
  category: 'Lácteos',
  description: 'Leche entera UHT',
  packageAmountMinor: 1,
  packageUnit: 'l',
  quantityMinor: 1,
  priceMinor: 129,
  retailerName: 'Mercado Demo',
  confidence: 0.94,
  warnings: ['Confirma el precio antes de guardarlo.'],
});

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2ZQAAAABJRU5ErkJggg==',
  'base64',
);

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function startFakeAi() {
  let structuredCalls = 0;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (request.method === 'GET' && path.endsWith('/models')) {
      return json(response, 200, { object: 'list', data: [{ id: 'basketra-test-model', object: 'model' }] });
    }
    if (request.method === 'POST' && path.endsWith('/files')) {
      await readBody(request);
      return json(response, 200, { id: 'file_basketra_test', object: 'file', bytes: ONE_PIXEL_PNG.length, filename: 'product.png', purpose: 'vision' });
    }
    if (request.method === 'POST' && path.endsWith('/chat/completions')) {
      await readBody(request);
      structuredCalls += 1;
      return json(response, 200, {
        id: `chatcmpl_${structuredCalls}`,
        object: 'chat.completion',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(PRODUCT_PROPOSAL) } }],
      });
    }
    if (request.method === 'POST' && path.endsWith('/responses')) {
      await readBody(request);
      structuredCalls += 1;
      return json(response, 200, {
        id: `resp_${structuredCalls}`,
        object: 'response',
        status: 'completed',
        output_text: JSON.stringify(PRODUCT_PROPOSAL),
        output: [{
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(PRODUCT_PROPOSAL) }],
        }],
      });
    }
    await readBody(request);
    return json(response, 404, { error: { message: `Unsupported fake AI route: ${request.method} ${path}` } });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fake AI did not expose a TCP address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1/`,
    structuredCalls: () => structuredCalls,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

async function createList(page, baseUrl) {
  await page.goto(`${baseUrl}/#lists`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Nueva lista' }).click();
  await page.getByLabel('Nombre').fill('Foto producto');
  await page.getByRole('button', { name: 'Crear lista' }).click();
  await page.getByRole('heading', { name: 'Foto producto' }).waitFor();
}

async function openPhotoSheet(page) {
  await page.getByRole('button', { name: 'Añadir producto' }).click();
  await page.locator('#item-text').fill('Leche entera 1 L');
  await page.locator('#item-advanced').evaluate(element => { element.open = true; });
  await page.locator('#product-gallery').setInputFiles({
    name: 'product.png',
    mimeType: 'image/png',
    buffer: ONE_PIXEL_PNG,
  });
  await page.locator('#product-proposal').waitFor({ state: 'visible', timeout: 8_000 });
  await page.getByDisplayValue('Leche entera 1 L').waitFor();
  await page.getByDisplayValue('Marca Demo').waitFor();
  await page.getByDisplayValue('8412345678901').waitFor();
  await page.getByDisplayValue('1.29').waitFor();
  await page.getByDisplayValue('Mercado Demo').waitFor();
}

const root = mkdtempSync(join(tmpdir(), 'basketra-product-photo-browser-'));
const fakeAi = await startFakeAi();
const app = new BasketraServer({
  host: '127.0.0.1',
  port: 0,
  dataDir: join(root, 'data'),
  tempDir: join(root, 'tmp'),
  maxBodyBytes: 1024 * 1024,
  aiBaseUrl: fakeAi.baseUrl,
  aiModel: 'basketra-test-model',
  aiMaxRetries: 0,
  aiImageCapability: true,
  aiPdfCapability: false,
  overpassBaseUrl: 'http://127.0.0.1:9/api/',
  idleHibernateAfterMs: 0,
  idleExitAfterMs: 0,
});

let browser;
try {
  await app.listen();
  const address = app.address();
  const baseUrl = `http://${address.host}:${address.port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await createList(page, baseUrl);

  await openPhotoSheet(page);
  await page.locator('#proposal-canonical-name').fill('Leche entera corregida');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await page.locator('#item-dialog').waitFor({ state: 'hidden' });
  const beforeConfirm = await fetch(`${baseUrl}/api/v1/shopping-lists`);
  assert.equal(beforeConfirm.status, 200);
  const lists = await beforeConfirm.json();
  const detailBefore = await fetch(`${baseUrl}/api/v1/shopping-lists/${encodeURIComponent(lists.lists[0].id)}`).then(response => response.json());
  assert.equal(detailBefore.items.length, 0, 'Cancelling a photo proposal must not persist an item');

  await openPhotoSheet(page);
  await page.locator('#proposal-canonical-name').fill('Leche entera corregida');
  await page.locator('#proposal-variant-name').fill('Leche entera corregida 1 L');
  await page.locator('#item-form').getByRole('button', { name: 'Añadir' }).click();
  await page.locator('#item-dialog').waitFor({ state: 'hidden', timeout: 8_000 });
  await page.getByText('Leche entera 1 L', { exact: true }).waitFor();

  const suggestions = await fetch(`${baseUrl}/api/v1/products/suggestions?q=${encodeURIComponent('Leche entera corregida 1 L')}`).then(response => response.json());
  assert.equal(suggestions.suggestions.length, 1);
  assert.equal(suggestions.suggestions[0].categoryName, 'Lácteos');
  const productId = suggestions.suggestions[0].id;
  const product = await fetch(`${baseUrl}/api/v1/products/${encodeURIComponent(productId)}`).then(response => response.json());
  assert.equal(product.product.canonicalName, 'Leche entera corregida');
  assert.equal(product.product.brand, 'Marca Demo');
  assert.equal(product.product.ean, '8412345678901');
  assert.equal(product.priceHistory.length, 1);
  assert.equal(product.priceHistory[0].priceMinor, 129);
  assert.equal(product.priceHistory[0].retailerName, 'Mercado Demo');

  const callsAfterConfirmation = fakeAi.structuredCalls();
  await page.getByRole('button', { name: 'Añadir producto' }).click();
  await page.locator('#item-text').fill('Leche entera corregida 1 L');
  await page.locator('[data-product-id]').filter({ hasText: 'Leche entera corregida 1 L' }).waitFor({ timeout: 8_000 });
  await page.locator('[data-product-id]').filter({ hasText: 'Leche entera corregida 1 L' }).click();
  await page.locator('#item-form').getByRole('button', { name: 'Añadir' }).click();
  await page.locator('#item-dialog').waitFor({ state: 'hidden' });
  assert.equal(fakeAi.structuredCalls(), callsAfterConfirmation, 'Exact saved product reuse must not invoke AI again');

  await context.close();
  process.stdout.write('product-photo-browser-e2e: ok\n');
} finally {
  await browser?.close().catch(() => {});
  await app.close().catch(() => {});
  await fakeAi.close().catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
