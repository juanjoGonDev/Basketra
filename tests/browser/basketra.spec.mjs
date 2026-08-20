import { test, expect } from '@playwright/test';

const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==', 'base64');

function monitorRuntime(page, { allowOfflineErrors = false, allowServiceUnavailable = false, allowExpectedOcrFailure = false } = {}) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    const text = message.text();
    if (allowOfflineErrors && text.includes('net::ERR_INTERNET_DISCONNECTED')) return;
    if (allowServiceUnavailable && text.includes('503 (Service Unavailable)')) return;
    if (allowExpectedOcrFailure && text.includes('502 (Bad Gateway)')) return;
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
  const accessibleName = name === 'Lista' ? 'Listas' : name;
  return page.locator('.bottom-nav').getByRole('button', { name: accessibleName, exact: true }).click();
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

function isListDetailRead(response) {
  if (response.request().method() !== 'GET') return false;
  const { pathname } = new URL(response.url());
  return /^\/api\/v1\/shopping-lists\/[^/]+$/u.test(pathname);
}

async function actAndWaitForListReads(page, minimumReads, action) {
  let reads = 0;
  const onResponse = response => {
    if (isListDetailRead(response)) reads += 1;
  };
  page.on('response', onResponse);
  try {
    await action();
    await expect.poll(() => reads).toBeGreaterThanOrEqual(minimumReads);
  } finally {
    page.off('response', onResponse);
  }
}

async function gotoApp(page, options) {
  const failures = monitorRuntime(page, options);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Organiza la compra sin perder tiempo.' })).toBeVisible();
  await expect(page.locator('#connection-state')).toContainText('Conectado');
  return failures;
}

async function createList(page, name) {
  await navigate(page, 'Listas');
  await page.getByRole('button', { name: 'Nueva lista', exact: true }).click();
  const dialog = page.locator('#create-list-dialog');
  await dialog.getByLabel('Nombre', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Crear lista', exact: true }).click();
  await expect(page.locator('#active-list-title')).toHaveText(name);
}

async function openProductDialog(page) {
  if (await page.locator('#item-dialog').evaluate(dialog => dialog.open)) return;
  await page.getByRole('button', { name: 'Añadir producto', exact: true }).click();
  await expect(page.locator('#item-dialog')).toHaveAttribute('open', '');
}

async function addProduct(page, { name, quantity = '1', unit = 'unit', exact = false, substitutions = true }) {
  await openProductDialog(page);
  const dialog = page.locator('#item-dialog');
  await productInput(page).fill(name);
  await dialog.getByLabel('Cantidad', { exact: true }).fill(quantity);
  await page.locator('#item-unit').selectOption(unit);
  if (!(await page.locator('#item-advanced').evaluate(details => details.open))) {
    await page.locator('#item-advanced summary').click();
  }
  await setSwitch(page, 'Producto exacto', exact);
  await setSwitch(page, 'Permitir sustituciones', substitutions);
  await actAndWaitForListReads(page, 2, () => dialog.getByRole('button', { name: 'Añadir', exact: true }).click());
  await expect(page.locator('#pending-items')).toContainText(name);
}

async function stableBoundingBox(locator) {
  let box = null;
  await expect.poll(async () => {
    box = await locator.boundingBox();
    return box !== null;
  }).toBe(true);
  return box;
}

async function swipe(page, locator, direction, { long = false } = {}) {
  await expect(locator).toBeVisible();
  await locator.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const box = await stableBoundingBox(locator);
  const anchor = locator.locator('.list-row__content').first();
  const anchorBox = await stableBoundingBox(anchor);
  const startX = direction === 'left' ? anchorBox.x + anchorBox.width * 0.8 : anchorBox.x + anchorBox.width * 0.2;
  const distance = box.width * (long ? 0.72 : direction === 'right' ? 0.46 : 0.34);
  const endX = direction === 'left' ? startX - distance : startX + distance;
  const y = anchorBox.y + anchorBox.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 14 });
  await page.mouse.up();
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

async function openCaptureDetails(page, index = 0) {
  const details = page.locator('.capture-card__details').nth(index);
  if (!(await details.evaluate(element => element.open))) await details.locator('summary').click();
  return details;
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
  const heights = await page.locator('button:visible').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
  expect(heights.every(height => height >= 44)).toBeTruthy();
  for (const destination of ['Inicio', 'Listas', 'Tickets', 'Planes', 'Ajustes']) {
    await navigate(page, destination);
    await expectNoHorizontalOverflow(page);
  }
  await expect(page.getByText('Basketra no requiere token de aplicación')).toBeVisible();
  expect(failures).toEqual([]);
});

test('shopping lists support progressive swipe reveal, completion, full-delete and undo', async ({ page }, testInfo) => {
  const failures = await gotoApp(page);
  await createList(page, 'Compra E2E');

  await page.locator('#list-menu').click();
  await page.getByRole('button', { name: 'Renombrar', exact: true }).click();
  const renameDialog = page.locator('#rename-list-dialog');
  await renameDialog.getByLabel('Nombre', { exact: true }).fill('Compra completa');
  await renameDialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.locator('#active-list-title')).toHaveText('Compra completa');

  await addProduct(page, { name: 'Leche entera 1 L', quantity: '2', unit: 'l', exact: true, substitutions: false });
  await addProduct(page, { name: 'Arroz 1 kg', quantity: '1', unit: 'kg' });

  let milkRow = page.locator('[data-swipe-kind="shopping-item"]').filter({ hasText: 'Leche entera 1 L' });
  await actAndWaitForListReads(page, 1, () => page.getByRole('button', { name: 'Aumentar cantidad de Leche entera 1 L' }).click());
  milkRow = page.locator('[data-swipe-kind="shopping-item"]').filter({ hasText: 'Leche entera 1 L' });
  await expect(milkRow.locator('.quantity-chip')).toHaveText('3');

  await swipe(page, milkRow, 'left');
  await expect(milkRow).toHaveAttribute('data-swipe-open', 'true');
  await expect(page.getByRole('button', { name: 'Editar Leche entera 1 L' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Eliminar Leche entera 1 L' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('swipe-reveal.png') });
  await page.getByRole('button', { name: 'Editar Leche entera 1 L' }).click();
  await productInput(page).fill('Leche semidesnatada 1 L');
  await actAndWaitForListReads(page, 2, () => page.locator('#item-dialog').getByRole('button', { name: 'Guardar cambios', exact: true }).click());
  await expect(page.locator('#pending-items')).toContainText('Leche semidesnatada 1 L');

  let riceRow = page.locator('[data-swipe-kind="shopping-item"]').filter({ hasText: 'Arroz 1 kg' });
  await swipe(page, riceRow, 'right');
  const completedSection = page.locator('#completed-section');
  await completedSection.locator('summary').click();
  await expect(completedSection).toHaveAttribute('open', '');
  await actAndWaitForListReads(page, 1, () => page.getByRole('button', { name: 'Devolver Arroz 1 kg a pendientes' }).click());
  await expect(page.locator('#pending-items')).toContainText('Arroz 1 kg');

  await actAndWaitForListReads(page, 1, () => page.getByRole('button', { name: 'Subir Arroz 1 kg' }).click());
  await expect(page.locator('#pending-items [data-swipe-kind="shopping-item"]').first()).toContainText('Arroz 1 kg');

  riceRow = page.locator('[data-swipe-kind="shopping-item"]').filter({ hasText: 'Arroz 1 kg' });
  await swipe(page, riceRow, 'left', { long: true });
  await expect(page.locator('#pending-items')).not.toContainText('Arroz 1 kg');
  await expect(page.locator('#toast-message')).toHaveText('Producto eliminado');
  await expect(page.getByRole('button', { name: 'Deshacer' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('swipe-delete.png') });
  await actAndWaitForListReads(page, 2, () => page.getByRole('button', { name: 'Deshacer' }).click());
  await expect(page.locator('#pending-items')).toContainText('Arroz 1 kg');

  const restoredRice = page.locator('[data-swipe-kind="shopping-item"]').filter({ hasText: 'Arroz 1 kg' });
  await page.getByRole('button', { name: 'Mostrar acciones de Arroz 1 kg' }).click();
  await expect(restoredRice).toHaveAttribute('data-swipe-open', 'true');
  await page.keyboard.press('Escape');
  await expect(restoredRice).toHaveAttribute('data-swipe-open', 'false');
  await page.getByRole('button', { name: 'Mostrar acciones de Arroz 1 kg' }).click();
  await page.getByRole('button', { name: 'Eliminar Arroz 1 kg' }).click();
  await page.locator('#delete-item-dialog').getByRole('button', { name: 'Eliminar producto', exact: true }).click();
  await expect(page.locator('#pending-items')).not.toContainText('Arroz 1 kg');

  await page.reload();
  await navigate(page, 'Listas');
  await page.locator('[data-list-action="open"]').filter({ hasText: 'Compra completa' }).click();
  await expect(page.locator('#active-list-title')).toHaveText('Compra completa');
  await expect(page.locator('#pending-items')).toContainText('Leche semidesnatada 1 L');
  await expect(page.locator('#pending-items')).not.toContainText('Arroz 1 kg');

  await page.locator('#list-menu').click();
  await page.getByRole('button', { name: 'Eliminar lista', exact: true }).click();
  await page.locator('#delete-list-dialog').getByRole('button', { name: 'Eliminar lista', exact: true }).click();
  await expect(page.locator('#list-cards')).toContainText('Tu primera lista empieza aquí');
  await expectNoHorizontalOverflow(page);
  expect(failures).toEqual([]);
});

test('local suggestions ignore stale responses and never require AI', async ({ page }) => {
  const failures = monitorRuntime(page);
  await page.route('**/api/v1/products/suggestions**', async route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'le') await new Promise(resolve => setTimeout(resolve, 450));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [{ id: query, name: query === 'le' ? 'Old stale result' : 'Leche nueva 1 L', source: 'catalog' }] }) });
  });
  await page.goto('/');
  await createList(page, 'Suggestions E2E');
  await openProductDialog(page);
  await productInput(page).fill('le');
  await page.waitForTimeout(220);
  await productInput(page).fill('lech');
  await expect(page.getByRole('option', { name: /Leche nueva 1 L/ })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByText('Old stale result')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('automatic local OCR creates editable euro rows with source context and imports without AI', async ({ page }, testInfo) => {
  const failures = await gotoApp(page);
  await navigate(page, 'Tickets');

  await expect(page.locator('#receipt-camera')).toHaveAttribute('capture', 'environment');
  await expect(page.locator('#receipt-camera')).toHaveAttribute('accept', 'image/jpeg,image/png');
  await expect(page.locator('#receipt-files')).toHaveAttribute('accept', 'image/jpeg,image/png,application/pdf');
  await expect(page.locator('#receipt-text')).toHaveCount(0);
  await expect(page.getByLabel('Corregir OCR con IA')).toBeDisabled();
  await expect(page.locator('#receipt-ai-help')).toContainText('OCR local en español activo');
  await expect(page.getByRole('button', { name: 'Leer con OCR local', exact: true })).toHaveCount(0);

  await page.locator('#receipt-files').setInputFiles([
    { name: 'camera.png', mimeType: 'image/png', buffer: validPng },
    { name: 'gallery.png', mimeType: 'image/png', buffer: validPng },
  ]);

  await expect(page.locator('#capture-list li')).toHaveCount(2);
  await expect(page.locator('#capture-list img[data-capture-preview-image]')).toHaveCount(2);
  await expect(page.locator('#receipt-state')).toContainText('Todas las imágenes están combinadas');
  await expect(page.locator('#receipt-review-panel')).toHaveAttribute('open', '');
  await expect(page.locator('#receipt-review-reference-image')).toBeVisible();
  await expect(page.locator('.receipt-item')).toHaveCount(1);
  await expect(page.getByLabel('Precio unitario (€)').first()).toHaveValue('1.20');
  await expect(page.getByLabel('Total (€)').first()).toHaveValue('1.20');
  await expect(page.getByLabel('Total declarado (€)')).toHaveValue('1.20');
  await expect(page.locator('#receipt-review-sticky-summary')).toContainText('1,20 €');
  await expect(page.getByText(/céntimos|cént\./i)).toHaveCount(0);

  const firstLineShell = page.locator('[data-swipe-kind="receipt-line"]').first();
  await page.getByRole('button', { name: 'Mostrar acciones de la línea 1' }).click();
  await expect(firstLineShell).toHaveAttribute('data-swipe-open', 'true');
  const firstLineEdit = firstLineShell.getByRole('button', { name: 'Editar línea 1', exact: true });
  await expect(firstLineEdit).toBeVisible();
  await expect(firstLineShell.getByRole('button', { name: 'Eliminar línea 1', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('swipe-reveal.png') });
  await firstLineEdit.click();
  const editorDialog = page.locator('#receipt-line-dialog');
  await expect(editorDialog).toBeVisible();
  const editorDescription = editorDialog.locator('[data-field="description"]');
  await expect(editorDescription).toBeFocused();
  await editorDescription.fill('Whole milk');
  await editorDialog.getByRole('button', { name: 'Guardar línea', exact: true }).click();

  await page.getByRole('button', { name: 'Añadir línea', exact: true }).click();
  await expect(page.locator('.receipt-item')).toHaveCount(2);
  await expect(page.locator('.receipt-line-compact')).toHaveCount(2);
  await page.locator('.receipt-line-compact').last().click();
  await expect(editorDialog).toBeVisible();
  await editorDialog.locator('[data-field="description"]').fill('Bread');
  await editorDialog.locator('[data-field="quantity"]').fill('1');
  await editorDialog.locator('[data-field="unitPriceEuro"]').fill('0.20');
  await editorDialog.locator('[data-field="lineTotalEuro"]').fill('0.20');
  await editorDialog.getByRole('button', { name: 'Guardar línea', exact: true }).click();

  const manualLineShell = page.locator('[data-swipe-kind="receipt-line"]').last();
  await page.getByRole('button', { name: 'Mostrar acciones de la línea 2' }).click();
  await expect(manualLineShell).toHaveAttribute('data-swipe-open', 'true');
  await page.getByRole('button', { name: 'Eliminar línea 2', exact: true }).click();
  await expect(page.locator('.receipt-item')).toHaveCount(1);
  await expect(page.locator('#toast-message')).toHaveText('Línea eliminada');
  await expect(page.getByRole('button', { name: 'Deshacer' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('swipe-delete.png') });
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator('.receipt-item')).toHaveCount(2);
  await expect(page.locator('.receipt-item').last().locator('[data-field="description"]')).toHaveValue('Bread');
  await expect(page.locator('.receipt-item').last().locator('[data-field="unitPriceEuro"]')).toHaveValue('0.20');

  const manualDetails = page.locator('.manual-entry');
  await expect(manualDetails).not.toHaveAttribute('open', '');
  await manualDetails.locator('summary').click();
  await expect(manualDetails).toHaveAttribute('open', '');
  await page.getByLabel('Total declarado (€)').fill('1.40');
  await page.getByRole('button', { name: 'Validar líneas e importes', exact: true }).click();
  await expect(page.locator('#receipt-state')).toContainText('Líneas y total validados');

  await page.locator('#confirm-receipt').click();
  await expect(page.locator('#receipt-state')).toContainText('Ticket importado');
  await expect(page.locator('#capture-list li')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  expect(failures).toEqual([]);
});

test('automatic local OCR failure preserves captures and supports per-image retry', async ({ page }) => {
  const failures = await gotoApp(page, { allowExpectedOcrFailure: true });
  await navigate(page, 'Tickets');
  let failOnce = true;
  await page.route('**/api/v1/receipts/extract', async route => {
    if (failOnce) {
      failOnce = false;
      await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'OCR_LOCAL_PROCESS_FAILED', message: 'El OCR local no pudo leer la imagen; el borrador se conserva', requestId: 'ocr-test' } }) });
      return;
    }
    await route.continue();
  });

  await page.locator('#receipt-camera').setInputFiles({ name: 'manual.png', mimeType: 'image/png', buffer: validPng });
  await expect(page.locator('#receipt-state')).toContainText('1 imágenes con error');
  await expect(page.locator('#capture-list li')).toHaveCount(1);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');
  const details = await openCaptureDetails(page);
  await expect(details.getByRole('button', { name: 'Reintentar imagen', exact: true })).toBeVisible();
  await expect(page.locator('.receipt-item')).toHaveCount(0);

  await details.getByRole('button', { name: 'Reintentar imagen', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  await expect(page.locator('#receipt-state')).toContainText('Todas las imágenes están combinadas');
  await expect(page.locator('.receipt-item')).toHaveCount(1);
  await expect(page.locator('#capture-list li')).toHaveCount(1);
  expect(failures).toEqual([]);
});

test('comparison renders all deterministic plans in euros', async ({ page }) => {
  const failures = await gotoApp(page);
  await navigate(page, 'Planes');
  await page.getByRole('button', { name: 'Generar ejemplo verificable', exact: true }).click();
  await page.getByRole('tab', { name: 'Comparativa', exact: true }).click();
  const rows = page.locator('.plan-comparison-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'Un solo comercio' })).toBeVisible();
  await expect(rows.filter({ hasText: 'Equilibrio recomendado' })).toBeVisible();
  await expect(rows.filter({ hasText: 'Máximo ahorro' })).toBeVisible();
  await expect(rows.first()).toContainText('€');
  await expect(page.getByText(/cént\./i)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  expect(failures).toEqual([]);
});

test('AI unavailability is recoverable and does not overwrite list input', async ({ page }) => {
  const failures = await gotoApp(page, { allowServiceUnavailable: true });
  await createList(page, 'AI E2E');
  await openProductDialog(page);
  await productInput(page).fill('pan integral');
  await page.locator('#item-dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();

  await page.locator('#open-ai-assistant').click();
  const aiDialog = page.locator('#ai-assistant-dialog');
  await aiDialog.getByLabel('Describe lo que necesitas', { exact: true }).fill('pan integral');
  await aiDialog.getByRole('button', { name: 'Preparar propuesta', exact: true }).click();
  await expect(page.locator('#ai-state')).toContainText(/La IA no está configurada|Proveedor IA no disponible/);
  await aiDialog.getByRole('button', { name: 'Cerrar', exact: true }).click();

  await openProductDialog(page);
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
  const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, outline: getComputedStyle(document.activeElement).outlineStyle }));
  expect(focus.tag).not.toBe('BODY');
  expect(focus.outline).not.toBe('none');
  await context.setOffline(false);
  expect(failures).toEqual([]);
});
