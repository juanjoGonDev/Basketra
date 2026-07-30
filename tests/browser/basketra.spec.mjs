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

async function setSwitch(page, label, checked) {
  const input = page.getByLabel(label, { exact: true });
  if (await input.isChecked() === checked) return;
  await page.locator('label.switch-row').filter({ has: input }).click();
  if (checked) await expect(input).toBeChecked();
  else await expect(input).not.toBeChecked();
}

async function gotoApp(page, options) {
  const failures = monitorRuntime(page, options);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Organiza la compra sin perder tiempo.' })).toBeVisible();
  await expect(page.locator('#connection-state')).toContainText('Conectado');
  return failures;
}

async function createList(page, name) {
  await navigate(page, 'Lista');
  await page.getByLabel('Nueva lista', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.locator('#list-select')).toContainText(name);
}

async function addProduct(page, { name, quantity = '1', unit = 'unit', exact = false, substitutions = true }) {
  await productInput(page).fill(name);
  await page.getByLabel('Cantidad', { exact: true }).fill(quantity);
  await page.locator('#item-unit').selectOption(unit);
  await setSwitch(page, 'Producto exacto', exact);
  await setSwitch(page, 'Permitir sustituciones', substitutions);
  await page.getByRole('button', { name: 'Añadir a la lista', exact: true }).click();
  await expect(page.locator('#pending-items')).toContainText(name);
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

test.afterEach(async ({ page }, testInfo) => {
  if (page.isClosed()) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({ path: testInfo.outputPath('viewport.png') });
  await page.evaluate(() => {
    for (const selector of ['.app-header', '.bottom-nav', '#toast']) {
      const element = document.querySelector(selector);
      if (element) element.hidden = true;
    }
    document.querySelector('.sticky-action')?.classList.remove('sticky-action');
  });
  const activeView = page.locator('.view.active');
  if (await activeView.count()) await activeView.screenshot({ path: testInfo.outputPath('final.png') });
});

test('mobile PWA loads with private-network messaging and touch-safe navigation', async ({ page, request }) => {
  const failures = await gotoApp(page);
  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({ name: 'Basketra', short_name: 'Basketra', display: 'standalone' });
  expect(manifest.icons.length).toBeGreaterThan(0);
  await expect(page.getByText('Sólo en tu red privada')).toBeVisible();
  await expect(page.locator('.bottom-nav button')).toHaveCount(5);
  const heights = await page.locator('button:visible').evaluateAll(buttons => buttons.map(button => buttons.length ? button.getBoundingClientRect().height : 0));
  expect(heights.every(height => height >= 44)).toBeTruthy();
  for (const destination of ['Inicio', 'Lista', 'Tickets', 'Planes', 'Ajustes']) {
    await navigate(page, destination);
    await expectNoHorizontalOverflow(page);
  }
  await expect(page.getByText('Basketra no requiere token de aplicación')).toBeVisible();
  expect(failures).toEqual([]);
});

test('shopping lists support create, rename, edit, quantities, completion, ordering and deletion', async ({ page }) => {
  const failures = await gotoApp(page);
  await createList(page, 'Compra E2E');

  await page.getByRole('button', { name: 'Renombrar', exact: true }).click();
  await page.getByLabel('Nuevo nombre', { exact: true }).fill('Compra completa');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.locator('#list-select')).toContainText('Compra completa');

  await addProduct(page, { name: 'Leche entera 1 L', quantity: '2', unit: 'l', exact: true, substitutions: false });
  await addProduct(page, { name: 'Arroz 1 kg', quantity: '1', unit: 'kg' });

  await page.getByRole('button', { name: 'Aumentar cantidad de Leche entera 1 L' }).click();
  await expect(page.locator('[data-item-row]').filter({ hasText: 'Leche entera 1 L' }).locator('.quantity-chip')).toHaveText('3');

  await page.getByRole('button', { name: 'Editar Leche entera 1 L' }).click();
  await productInput(page).fill('Leche semidesnatada 1 L');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.locator('#pending-items')).toContainText('Leche semidesnatada 1 L');

  await page.getByRole('button', { name: 'Marcar Arroz 1 kg como comprado' }).click();
  await expect(page.locator('#completed-items')).toContainText('Arroz 1 kg');
  await page.getByRole('button', { name: 'Devolver Arroz 1 kg a pendientes' }).click();
  await expect(page.locator('#pending-items')).toContainText('Arroz 1 kg');

  await page.getByRole('button', { name: 'Subir Arroz 1 kg' }).click();
  await expect(page.locator('#pending-items [data-item-row]').first()).toContainText('Arroz 1 kg');

  await page.getByRole('button', { name: 'Eliminar Arroz 1 kg' }).click();
  await page.getByRole('button', { name: 'Eliminar producto', exact: true }).click();
  await expect(page.locator('#pending-items')).not.toContainText('Arroz 1 kg');

  await page.reload();
  await navigate(page, 'Lista');
  await expect(page.locator('#list-select')).toContainText('Compra completa');
  await expect(page.locator('#pending-items')).toContainText('Leche semidesnatada 1 L');

  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.getByRole('button', { name: 'Eliminar lista', exact: true }).click();
  await expect(page.locator('#list-select')).toContainText('Todavía no hay listas');
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
  await page.goto('/');
  await createList(page, 'Suggestions E2E');
  await productInput(page).fill('le');
  await page.waitForTimeout(220);
  await productInput(page).fill('lech');
  await expect(page.getByRole('option', { name: 'Leche nueva 1 L' })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByText('Old stale result')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('camera, gallery and PDF captures preview, reorder, correct and import without AI', async ({ page }) => {
  const failures = await gotoApp(page);
  await navigate(page, 'Tickets');

  await expect(page.locator('#receipt-camera')).toHaveAttribute('capture', 'environment');
  await expect(page.locator('#receipt-camera')).toHaveAttribute('accept', 'image/jpeg,image/png');
  await expect(page.locator('#receipt-files')).toHaveAttribute('accept', 'image/jpeg,image/png,application/pdf');

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]);
  const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00]);
  await page.locator('#receipt-camera').setInputFiles({ name: 'camera.png', mimeType: 'image/png', buffer: png });
  await page.locator('#receipt-files').setInputFiles([
    { name: 'gallery.png', mimeType: 'image/png', buffer: png },
    { name: 'receipt.pdf', mimeType: 'application/pdf', buffer: pdf },
  ]);

  await expect(page.locator('#capture-list li')).toHaveCount(3);
  await expect(page.locator('#capture-list img[data-capture-preview-image]')).toHaveCount(2);
  await expect(page.locator('#capture-list')).toContainText('PDF');

  await page.getByRole('button', { name: 'Ampliar camera.png' }).click();
  await expect(page.locator('#capture-preview-dialog')).toBeVisible();
  await expect(page.locator('#capture-preview-image')).toHaveAttribute('src', /\/api\/v1\/files\//);
  await page.getByRole('button', { name: 'Cerrar vista previa' }).click();

  await page.getByRole('button', { name: 'Bajar camera.png' }).click();
  await expect(page.locator('#capture-list li').nth(1)).toContainText('camera.png');
  await page.getByRole('button', { name: 'Retirar receipt.pdf del borrador' }).click();
  await expect(page.locator('#capture-list li')).toHaveCount(2);

  await page.getByText('Introducción manual y opciones avanzadas', { exact: true }).click();
  await page.getByLabel('Texto extraído o transcripción', { exact: true }).fill('Milk;1;120;120\nTOTAL 1,20');
  await page.getByLabel('Total declarado (céntimos)', { exact: true }).fill('120');
  await setSwitch(page, 'Verificar y normalizar con IA', false);
  await page.getByRole('button', { name: 'Procesar capturas', exact: true }).click();
  await expect(page.locator('#receipt-state')).toContainText('Extracción lista');
  await expect(page.locator('#receipt-review')).toContainText('Total validado');

  await page.locator('.receipt-item [data-field="description"]').fill('Whole milk');
  await page.getByRole('button', { name: 'Confirmar e importar', exact: true }).click();
  await expect(page.locator('#receipt-state')).toContainText('Ticket importado');
  await expect(page.locator('#capture-list li')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('manual receipt recovery preserves the draft when AI is unavailable', async ({ page }) => {
  const failures = await gotoApp(page, { allowServiceUnavailable: true });
  await navigate(page, 'Tickets');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]);
  await page.locator('#receipt-camera').setInputFiles({ name: 'manual.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Procesar capturas', exact: true }).click();
  await expect(page.locator('#receipt-state')).toContainText('No hay OCR configurado');
  await expect(page.locator('#capture-list li')).toHaveCount(1);
  await page.getByLabel('Texto extraído o transcripción', { exact: true }).fill('Bread;1;150;150\nTOTAL 1,50');
  await page.getByLabel('Total declarado (céntimos)', { exact: true }).fill('150');
  await page.getByRole('button', { name: 'Revisar transcripción', exact: true }).click();
  await expect(page.locator('#receipt-review')).toContainText('Total validado');
  expect(failures).toEqual([]);
});

test('comparison renders all deterministic plans', async ({ page }) => {
  const failures = await gotoApp(page);
  await navigate(page, 'Planes');
  await page.getByRole('button', { name: 'Generar ejemplo verificable', exact: true }).click();
  await expect(page.locator('#plans article')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Un solo comercio' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Equilibrio recomendado' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Máximo ahorro' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(failures).toEqual([]);
});

test('AI unavailability is recoverable and does not overwrite list input', async ({ page }) => {
  const failures = await gotoApp(page, { allowServiceUnavailable: true });
  await createList(page, 'AI E2E');
  await productInput(page).fill('pan integral');
  await page.locator('.ai-card summary').click();
  await expect(page.locator('#ai-mode')).toBeVisible();
  await page.locator('#ai-mode').selectOption('manual');
  await page.getByRole('button', { name: 'Analizar texto', exact: true }).click();
  await expect(page.locator('#ai-state')).toContainText('Proveedor IA no disponible');
  await expect(productInput(page)).toHaveValue('pan integral');
  expect(failures).toEqual([]);
});

test('offline shell reloads and keyboard focus remains visible', async ({ page, context }) => {
  const failures = monitorRuntime(page, { allowOfflineErrors: true });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Organiza la compra sin perder tiempo.' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Organiza la compra sin perder tiempo.' })).toBeVisible();
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
