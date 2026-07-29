import { test, expect } from '@playwright/test';

function monitorRuntime(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => {
    const failure = request.failure()?.errorText ?? '';
    if (!failure.includes('ERR_INTERNET_DISCONNECTED') && !failure.includes('net::ERR_ABORTED')) {
      failures.push(`request: ${request.method()} ${request.url()} ${failure}`);
    }
  });
  return failures;
}

async function gotoApp(page) {
  const failures = monitorRuntime(page);
  await page.goto('/');
  await expect(page.getByText('Tu cesta, con evidencia')).toBeVisible();
  return failures;
}

async function createList(page, name) {
  await page.getByRole('button', { name: 'Lista' }).click();
  page.once('dialog', dialog => dialog.accept(name));
  await page.getByRole('button', { name: 'Nueva' }).click();
  await expect(page.locator('#list-select')).toContainText(name);
}

test.afterEach(async ({ page }, testInfo) => {
  await page.screenshot({ path: testInfo.outputPath('final.png'), fullPage: true });
});

test('mobile PWA loads with valid manifest and touch-safe navigation', async ({ page, request }) => {
  const failures = await gotoApp(page);
  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({ name: 'Basketra', short_name: 'Basketra', display: 'standalone' });
  expect(manifest.icons.length).toBeGreaterThan(0);
  const heights = await page.locator('button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
  expect(heights.every(height => height >= 44)).toBeTruthy();
  await page.getByRole('button', { name: 'Escanear' }).click();
  await expect(page.getByRole('heading', { name: 'Capturar ticket' })).toBeVisible();
  expect(failures).toEqual([]);
});

test('shopping list preserves exact/substitution preferences and survives reload', async ({ page }) => {
  const failures = await gotoApp(page);
  await createList(page, 'Compra E2E');
  await page.getByLabel('Producto').fill('Leche entera 1 L');
  await page.getByLabel('Cantidad').fill('2');
  await page.getByLabel('Unidad').selectOption('l');
  await page.getByLabel('Producto exacto').check();
  await page.getByLabel('Permitir sustituciones').uncheck();
  await page.getByRole('button', { name: 'Añadir' }).click();
  await expect(page.locator('#items')).toContainText('Leche entera 1 L');
  await expect(page.locator('#items')).toContainText('exacto');
  await expect(page.locator('#items')).toContainText('Sin alternativas');
  await page.reload();
  await page.getByRole('button', { name: 'Lista' }).click();
  await expect(page.locator('#items')).toContainText('Leche entera 1 L');
  expect(failures).toEqual([]);
});

test('local suggestions ignore stale responses and never require AI', async ({ page }) => {
  const failures = monitorRuntime(page);
  await page.route('**/api/v1/products/suggestions**', async route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'le') await new Promise(resolve => setTimeout(resolve, 450));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ suggestions: [{ id: query, name: query === 'le' ? 'Old stale result' : 'Leche nueva 1 L', source: 'catalog' }] }),
    });
  });
  await page.goto('/#lists');
  await page.getByRole('button', { name: 'Lista' }).click();
  await page.getByLabel('Producto').fill('le');
  await page.waitForTimeout(220);
  await page.getByLabel('Producto').fill('lech');
  await expect(page.getByRole('option', { name: 'Leche nueva 1 L' })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByText('Old stale result')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('receipt captures upload, reorder, delete and show arithmetic review', async ({ page }) => {
  const failures = await gotoApp(page);
  await page.getByRole('button', { name: 'Escanear' }).click();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]);
  await page.locator('#receipt-files').setInputFiles([
    { name: 'page-1.png', mimeType: 'image/png', buffer: png },
    { name: 'page-2.png', mimeType: 'image/png', buffer: png },
  ]);
  await expect(page.locator('#capture-list li')).toHaveCount(2);
  await page.locator('#capture-list li').first().getByRole('button', { name: 'Bajar' }).click();
  await expect(page.locator('#capture-list li').first()).toContainText('page-2.png');
  await page.locator('#capture-list li').last().getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.locator('#capture-list li')).toHaveCount(1);
  await page.getByLabel('Texto extraído o transcripción').fill('Milk;1;120;120');
  await page.getByLabel('Total declarado (céntimos)').fill('120');
  await page.getByRole('button', { name: 'Revisar ticket' }).click();
  await expect(page.locator('#receipt-review')).toContainText('correcto');
  await expect(page.locator('#receipt-review')).toContainText('confirmed');
  expect(failures).toEqual([]);
});

test('comparison renders all deterministic plans and Prime evidence behavior', async ({ page }) => {
  const failures = await gotoApp(page);
  await page.getByRole('button', { name: 'Precios' }).click();
  await page.getByRole('button', { name: 'Generar ejemplo verificable' }).click();
  await expect(page.locator('#plans article')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Un solo comercio' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Equilibrio recomendado' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Máximo ahorro' })).toBeVisible();
  expect(failures).toEqual([]);
});

test('AI unavailability is recoverable and does not overwrite input', async ({ page }) => {
  const failures = await gotoApp(page);
  await page.getByRole('button', { name: 'Lista' }).click();
  await page.getByLabel('Producto').fill('pan integral');
  await page.getByLabel('Asistencia IA').selectOption('manual');
  await page.getByRole('button', { name: 'Analizar con IA' }).click();
  await expect(page.locator('#ai-state')).toContainText('Proveedor IA no disponible');
  await expect(page.getByLabel('Producto')).toHaveValue('pan integral');
  expect(failures).toEqual([]);
});

test('offline shell reloads and keyboard focus remains visible', async ({ page, context }) => {
  const failures = await gotoApp(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Tu cesta, con evidencia')).toBeVisible();
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, outline: getComputedStyle(document.activeElement).outlineStyle }));
  expect(focus.tag).not.toBe('BODY');
  expect(focus.outline).not.toBe('none');
  await context.setOffline(false);
  expect(failures).toEqual([]);
});
