import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { BasketraServer } from '../src/api/server.ts';

const root = mkdtempSync(join(tmpdir(), 'basketra-collaboration-browser-'));
const artifacts = join(process.cwd(), 'artifacts', 'browser', 'collaboration');
mkdirSync(artifacts, { recursive: true });

const server = new BasketraServer({
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
});

let browser;

async function waitForListText(page, text) {
  await page.locator('#pending-items, #completed-items').getByText(text, { exact: true }).waitFor({ state: 'visible', timeout: 8_000 });
}

function rowFor(page, text) {
  return page.locator('.list-row').filter({ has: page.getByText(text, { exact: true }) });
}

async function openLists(page, baseUrl) {
  await page.goto(`${baseUrl}/#lists`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '¿Qué compra preparas?' }).waitFor();
}

async function createList(page, name) {
  await page.getByRole('button', { name: 'Nueva lista' }).click();
  await page.getByLabel('Nombre').fill(name);
  await page.getByRole('button', { name: 'Crear lista' }).click();
  await page.getByRole('heading', { name }).waitFor();
  await page.getByText('En tiempo real', { exact: true }).waitFor({ timeout: 8_000 });
}

async function openExistingList(page, name) {
  await page.locator('[data-list-action="open"]').filter({ hasText: name }).click();
  await page.getByRole('heading', { name }).waitFor();
  await page.getByText('En tiempo real', { exact: true }).waitFor({ timeout: 8_000 });
}

async function addItem(page, text) {
  await page.getByRole('button', { name: 'Añadir producto' }).click();
  await page.locator('#item-dialog').waitFor({ state: 'visible' });
  await page.locator('#item-text').fill(text);
  await page.locator('#item-quantity').fill('1');
  await page.locator('#item-unit').selectOption('unit');
  await page.locator('#item-form').getByRole('button', { name: 'Añadir' }).click();
  await page.locator('#item-dialog').waitFor({ state: 'hidden' });
  await waitForListText(page, text);
}

async function editItem(page, currentText, nextText, waitForDialogClose = true) {
  const row = rowFor(page, currentText);
  await row.getByRole('button', { name: `Editar ${currentText}` }).click();
  await page.locator('#item-dialog').waitFor({ state: 'visible' });
  await page.locator('#item-text').fill(nextText);
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  if (waitForDialogClose) await page.locator('#item-dialog').waitFor({ state: 'hidden' });
}

async function main() {
  await server.listen();
  const address = server.address();
  const baseUrl = `http://${address.host}:${address.port}`;

  browser = await chromium.launch({
    headless: true,
    args: ['--host-resolver-rules=MAP basketra.test 127.0.0.1'],
  });

  const deviceA = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const deviceB = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pageA = await deviceA.newPage();
  const pageB = await deviceB.newPage();

  await Promise.all([openLists(pageA, baseUrl), openLists(pageB, baseUrl)]);
  await createList(pageA, 'Compra compartida');
  await pageB.getByText('Compra compartida', { exact: true }).waitFor({ timeout: 8_000 });
  await openExistingList(pageB, 'Compra compartida');

  await addItem(pageA, 'Leche');
  await waitForListText(pageB, 'Leche');

  await rowFor(pageB, 'Leche').getByRole('button', { name: 'Marcar Leche como comprado' }).click();
  await pageB.locator('#completed-items').getByText('Leche', { exact: true }).waitFor({ timeout: 8_000 });
  await pageA.locator('#completed-items').getByText('Leche', { exact: true }).waitFor({ timeout: 8_000 });

  await rowFor(pageA, 'Leche').getByRole('button', { name: 'Marcar Leche como pendiente' }).click();
  await pageB.locator('#pending-items').getByText('Leche', { exact: true }).waitFor({ timeout: 8_000 });

  const rowA = rowFor(pageA, 'Leche');
  await rowA.getByRole('button', { name: 'Editar Leche' }).click();
  await pageA.locator('#item-dialog').waitFor({ state: 'visible' });
  await pageA.locator('#item-text').fill('Leche A');

  await editItem(pageB, 'Leche', 'Leche B');
  await waitForListText(pageB, 'Leche B');

  await pageA.getByRole('button', { name: 'Guardar cambios' }).click();
  await pageA.locator('#conflict-dialog').waitFor({ state: 'visible', timeout: 8_000 });
  await pageA.getByText('Leche A', { exact: true }).waitFor();
  await pageA.getByText('Leche B', { exact: true }).waitFor();
  await pageA.getByRole('button', { name: 'Usar mis cambios' }).click();
  await pageA.locator('#conflict-dialog').waitFor({ state: 'hidden' });
  await waitForListText(pageA, 'Leche A');
  await waitForListText(pageB, 'Leche A');

  await pageA.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await pageA.getByRole('button', { name: 'IA' }).waitFor({ state: 'visible' });
  const aiBox = await pageA.getByRole('button', { name: 'IA' }).boundingBox();
  const navBox = await pageA.locator('.bottom-nav').boundingBox();
  assert.ok(aiBox && navBox && aiBox.y + aiBox.height <= navBox.y, 'Floating AI action must not overlap bottom navigation');

  await pageA.screenshot({ path: join(artifacts, 'list-detail-390.png'), fullPage: true });

  const phone320 = await browser.newContext({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true });
  const page320 = await phone320.newPage();
  await openLists(page320, baseUrl);
  await openExistingList(page320, 'Compra compartida');
  assert.equal(await page320.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, '320px layout must not overflow horizontally');
  await page320.screenshot({ path: join(artifacts, 'list-detail-320.png'), fullPage: true });
  await phone320.close();

  const phone430 = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  const page430 = await phone430.newPage();
  await openLists(page430, baseUrl);
  await openExistingList(page430, 'Compra compartida');
  await page430.screenshot({ path: join(artifacts, 'list-detail-430.png'), fullPage: true });
  await phone430.close();

  const desktop = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const desktopPage = await desktop.newPage();
  await openLists(desktopPage, baseUrl);
  await openExistingList(desktopPage, 'Compra compartida');
  assert.equal(await desktopPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'Desktop layout must not overflow horizontally');
  await desktopPage.screenshot({ path: join(artifacts, 'list-detail-1024.png'), fullPage: true });
  await desktop.close();

  const savedStore = await fetch(`${baseUrl}/api/v1/stores`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      retailerName: 'Mercado',
      name: 'Mercado cercano',
      latitudeMicrodegrees: 40_416_800,
      longitudeMicrodegrees: -3_703_800,
    }),
  });
  assert.equal(savedStore.status, 201);

  const locationContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    geolocation: { latitude: 40.416775, longitude: -3.70379 },
    permissions: ['geolocation'],
  });
  const locationPage = await locationContext.newPage();
  await openLists(locationPage, baseUrl);
  await openExistingList(locationPage, 'Compra compartida');
  await locationPage.getByRole('button', { name: 'Añadir producto' }).click();
  await locationPage.locator('#item-advanced').evaluate(element => { element.open = true; });
  await locationPage.getByRole('button', { name: 'Usar mi ubicación para sugerir tienda' }).click();
  await locationPage.getByText(/tiendas guardadas cerca/i).waitFor({ timeout: 8_000 });
  await locationContext.close();

  const insecureContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const insecurePage = await insecureContext.newPage();
  const insecureUrl = `http://basketra.test:${address.port}`;
  await openLists(insecurePage, insecureUrl);
  await openExistingList(insecurePage, 'Compra compartida');
  await insecurePage.getByRole('button', { name: 'Añadir producto' }).click();
  await insecurePage.locator('#item-advanced').evaluate(element => { element.open = true; });
  await insecurePage.getByRole('button', { name: 'Usar mi ubicación para sugerir tienda' }).click();
  await insecurePage.getByText(/exige HTTPS/i).waitFor({ timeout: 8_000 });
  await insecureContext.close();

  await deviceA.close();
  await deviceB.close();
}

try {
  await main();
  process.stdout.write('collaboration-browser-e2e: ok\n');
} finally {
  await browser?.close().catch(() => {});
  await server.close().catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
