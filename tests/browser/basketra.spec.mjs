import { test, expect } from '@playwright/test';

function monitorRuntime(page, { allowOfflineErrors = false, allowServiceUnavailable = false } = {}) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    const text = message.text();
    if (allowOfflineErrors && text.includes('net::ERR_INTERNET_DISCONNECTED')) return;
    if (allowServiceUnavailable && text.includes('503 (Service Unavailable)')) return;
    if (message.type() === 'error') failures.push(`console: ${text}`);
  });
  page.on('requestfailed', request => {
    const failure = request.failure()?.errorText ?? '';
    if (!failure.includes('ERR_INTERNET_DISCONNECTED') && !failure.includes('net::ERR_ABORTED')) {
      failures.push(`request: ${request.method()} ${request.url()} ${failure}`);
    }
  });
  return failures;
}

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

function productInput(page) {
  return page.getByRole('textbox', { name: 'Producto', exact: true });
}

async function gotoApp(page) {
  const failures = monitorRuntime(page);
  await page.goto('/');
  await expect(page.getByText('Tu cesta, con evidencia')).toBeVisible();
  return failures;
}

async function createList(page, name) {
  await navigate(page, 'Lista');
  page.once('dialog', dialog => dialog.accept(name));
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await expect(page.locator('#list-select')).toContainText(name);
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

test.afterEach(async ({ page }, testInfo) => {
  await page.screenshot({ path: testInfo.outputPath('final.png'), fullPage: true });
});

test('mobile PWA loads with valid manifest and touch-safe icon navigation', async ({ page, request }) => {
  const failures = await gotoApp(page);
  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({ name: 'Basketra', short_name: 'Basketra', display: 'standalone' });
  expect(manifest.icons.length).toBeGreaterThan(0);
  await expect(page.locator('.bottom-nav .nav-icon svg')).toHaveCount(5);
  const heights = await page.locator('button:visible').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
  expect(heights.every(height => height >= 44)).toBeTruthy();
  await expectNoHorizontalOverflow(page);
  await navigate(page, 'Escanear');
  await expect(page.getByRole('heading', { name: 'Capturar ticket' })).toBeVisible();
  await expect(page.locator('.bottom-nav').getByRole('button', { name: 'Escanear', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(failures).toEqual([]);
});

test('reusable mobile design system stays aligned across all destinations', async ({ page }) => {
  const failures = await gotoApp(page);
  const tokens = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return ['--space-4', '--radius-lg', '--touch', '--primary'].map(token => styles.getPropertyValue(token).trim());
  });
  expect(tokens.every(Boolean)).toBeTruthy();
  for (const destination of ['Inicio', 'Lista', 'Escanear', 'Precios', 'Ajustes']) {
    await navigate(page, destination);
    await expectNoHorizontalOverflow(page);
    const visibleTargets = await page.locator('button:visible, summary:visible').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
    expect(visibleTargets.every(height => height >= 44)).toBeTruthy();
  }
  await expect(page.locator('.surface').first()).toBeVisible();
  expect(failures).toEqual([]);
});

test('shopping list preserves exact/substitution preferences and survives reload', async ({ page }) => {
  const failures = await gotoApp(page);
  await createList(page, 'Compra E2E');
  await productInput(page).fill('Leche entera 1 L');
  await page.getByLabel('Cantidad', { exact: true }).fill('2');
  await page.locator('#item-unit').selectOption('l');
  await page.getByLabel('Producto exacto', { exact: true }).check();
  await page.getByLabel('Permitir sustituciones', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(page.locator('#items')).toContainText('Leche entera 1 L');
  await expect(page.locator('#items')).toContainText('Producto exacto');
  await expect(page.locator('#items')).toContainText('Sin alternativas');
  await page.reload();
  await navigate(page, 'Lista');
  await expect(page.locator('#items')).toContainText('Leche entera 1 L');
  await expectNoHorizontalOverflow(page);
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
  await navigate(page, 'Lista');
  await productInput(page).fill('le');
  await page.waitForTimeout(220);
  await productInput(page).fill('lech');
  await expect(page.getByRole('option', { name: 'Leche nueva 1 L' })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByText('Old stale result')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('receipt captures extract, reorder, correct and import with evidence', async ({ page }) => {
  const failures = await gotoApp(page);
  await navigate(page, 'Escanear');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]);
  await page.locator('#receipt-files').setInputFiles([
    { name: 'page-1.png', mimeType: 'image/png', buffer: png },
    { name: 'page-2.png', mimeType: 'image/png', buffer: png },
  ]);
  await expect(page.locator('#capture-list li')).toHaveCount(2);
  await page.locator('#capture-list li').first().getByRole('button', { name: 'Bajar', exact: true }).click();
  await expect(page.locator('#capture-list li').first()).toContainText('page-2.png');
  await page.locator('#capture-list li').last().getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(page.locator('#capture-list li')).toHaveCount(1);
  await page.getByText('Introducción manual y opciones avanzadas', { exact: true }).click();
  await page.getByLabel('Texto extraído o transcripción', { exact: true }).fill('Milk;1;120;120\nTOTAL 1,20');
  await page.getByLabel('Total declarado (céntimos)', { exact: true }).fill('120');
  await page.getByLabel('Verificar y normalizar con IA', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Procesar capturas', exact: true }).click();
  await expect(page.locator('#receipt-state')).toContainText('Extracción lista');
  await expect(page.locator('#receipt-review')).toContainText('Total validado');
  await expect(page.locator('#receipt-review')).toContainText('confirmed');
  await page.locator('.receipt-item [data-field="description"]').fill('Whole milk');
  await page.getByRole('button', { name: 'Confirmar e importar', exact: true }).click();
  await expect(page.locator('#receipt-state')).toContainText('Ticket importado');
  await expect(page.locator('#capture-list li')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('comparison renders all deterministic plans and Prime evidence behavior', async ({ page }) => {
  const failures = await gotoApp(page);
  await navigate(page, 'Precios');
  await page.getByRole('button', { name: 'Generar ejemplo verificable', exact: true }).click();
  await expect(page.locator('#plans article')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Un solo comercio' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Equilibrio recomendado' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Máximo ahorro' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(failures).toEqual([]);
});

test('AI unavailability is recoverable and does not overwrite input', async ({ page }) => {
  const failures = monitorRuntime(page, { allowServiceUnavailable: true });
  await page.goto('/');
  await expect(page.getByText('Tu cesta, con evidencia')).toBeVisible();
  await navigate(page, 'Lista');
  await productInput(page).fill('pan integral');
  await page.locator('#ai-mode').selectOption('manual');
  await page.getByRole('button', { name: 'Analizar con IA', exact: true }).click();
  await expect(page.locator('#ai-state')).toContainText('Proveedor IA no disponible');
  await expect(productInput(page)).toHaveValue('pan integral');
  expect(failures).toEqual([]);
});

test('offline shell reloads and keyboard focus remains visible', async ({ page, context }) => {
  const failures = monitorRuntime(page, { allowOfflineErrors: true });
  await page.goto('/');
  await expect(page.getByText('Tu cesta, con evidencia')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Tu cesta, con evidencia')).toBeVisible();
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    outline: getComputedStyle(document.activeElement).outlineStyle,
  }));
  expect(focus.tag).not.toBe('BODY');
  expect(focus.outline).not.toBe('none');
  await context.setOffline(false);
  expect(failures).toEqual([]);
});
