import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);

async function createStore(request, retailerName, name) {
  const response = await request.post('/api/v1/stores', { data: { retailerName, name } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).store;
}

async function createProduct(request, input) {
  const response = await request.post('/api/v1/products', { data: input });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).product;
}

async function savePrice(request, productId, store, priceMinor, observedAt) {
  const response = await request.post(`/api/v1/products/${encodeURIComponent(productId)}/prices`, {
    data: {
      retailerName: store.retailerName,
      storeId: store.id,
      priceMinor,
      packageNumerator: 1,
      packageDenominator: 1,
      packageUnit: 'unit',
      observedAt,
      confidence: 1,
      evidenceType: 'manual',
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function createListWithItem(request, product) {
  const listResponse = await request.post('/api/v1/shopping-lists', { data: { name: 'Compra realtime' } });
  expect(listResponse.ok()).toBeTruthy();
  const list = (await listResponse.json()).list;
  const itemResponse = await request.post(`/api/v1/shopping-lists/${encodeURIComponent(list.id)}/items`, {
    data: {
      text: product.variantName,
      quantityMinor: 1,
      unit: 'unit',
      exactRequired: false,
      substitutionAllowed: true,
      productVariantId: product.id,
    },
  });
  expect(itemResponse.ok()).toBeTruthy();
  return { list, item: (await itemResponse.json()).item };
}

function runtimeErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function expectNoHorizontalOverflow(page) {
  await expect.poll(() => page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))).toEqual(expect.objectContaining({}));
  const geometry = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport + 1);
}

test('shopping ticket estimates by effective Store and converges between devices', async ({ page, request, context }, testInfo) => {
  test.setTimeout(45_000);
  const errors = runtimeErrors(page);
  const referenceStore = await createStore(request, 'Mercado', 'Mercado Centro');
  const overrideStore = await createStore(request, 'Mercado', 'Mercado Norte');
  const milk = await createProduct(request, {
    canonicalName: 'Leche',
    variantName: 'Leche entera 1 L',
    packageMinor: 1,
    packageUnit: 'l',
  });
  await savePrice(request, milk.id, referenceStore, 119, '2026-09-04T10:00:00.000Z');
  await savePrice(request, milk.id, overrideStore, 109, '2026-09-05T10:00:00.000Z');
  const { list } = await createListWithItem(request, milk);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/lists/${encodeURIComponent(list.id)}`);
  await expect(page.locator('#active-list-title')).toHaveText('Compra realtime');
  await expect(page.locator('.shopping-ticket')).toBeVisible();
  await expect(page.locator('#estimate-coverage')).toContainText('0 de 1 con precio');

  await page.locator('#list-store-select').selectOption(referenceStore.id);
  await expect(page.locator('#estimate-total')).toHaveText(/1,19/);
  const row = page.locator('[data-swipe-kind="shopping-item"]').filter({ hasText: 'Leche entera 1 L' });
  await expect(row).toContainText('Mercado Centro');

  await row.locator('[data-item-control="store"]').selectOption(overrideStore.id);
  await expect(page.locator('#estimate-total')).toHaveText(/1,09/);

  const second = await context.newPage();
  const secondErrors = runtimeErrors(second);
  await second.setViewportSize({ width: 320, height: 700 });
  await second.goto(`/lists/${encodeURIComponent(list.id)}`);
  await expect(second.locator('#estimate-total')).toHaveText(/1,09/);
  await expectNoHorizontalOverflow(second);

  await page.getByRole('button', { name: 'Aumentar cantidad de Leche entera 1 L', exact: true }).click();
  await expect(page.locator('#estimate-total')).toHaveText(/2,18/);
  await expect(second.locator('.quantity-chip')).toHaveText('2');
  await expect(second.locator('#estimate-total')).toHaveText(/2,18/);

  await page.locator('#apply-list-store-all').click();
  await expect(row.locator('[data-item-control="store"]')).toHaveValue('');
  await expect(page.locator('#estimate-total')).toHaveText(/2,38/);
  await expect(second.locator('#estimate-total')).toHaveText(/2,38/);

  await page.screenshot({ path: testInfo.outputPath('shopping-ticket-mobile-390.png'), fullPage: true });
  await second.screenshot({ path: testInfo.outputPath('shopping-ticket-mobile-320.png'), fullPage: true });
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
  expect(secondErrors).toEqual([]);
  await second.close();
});

test('scan choice routes tickets separately and product photo AI hydrates the canonical product form', async ({ page, request }, testInfo) => {
  test.setTimeout(45_000);
  const errors = runtimeErrors(page);
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true, baseUrl: 'http://webapi.test/v1/', model: 'default' }),
  }));
  await page.route('**/api/v1/ai/runtime-capabilities', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      attachments: {
        maxCount: 10,
        maxFileBytes: 8 * 1024 * 1024,
        maxImageBytes: 4 * 1024 * 1024,
        maxSpreadsheetBytes: 4 * 1024 * 1024,
        maxUploadsPerThreeHours: 80,
      },
      execution: { replyInactivityTimeoutMs: 120_000 },
      requests: { maxJsonBodyBytes: 8 * 1024 * 1024 },
    }),
  }));
  await page.route('**/api/v1/products/photo-proposal', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      proposal: {
        canonicalName: 'Leche',
        variantName: 'Leche entera 1 L',
        brand: 'Hacendado',
        ean: '8480000123456',
        category: 'Lácteos',
        packageAmountMinor: 1,
        packageUnit: 'l',
        quantityMinor: 1,
        unit: 'unit',
        priceMinor: 119,
        retailerName: 'Mercado',
        storeName: 'Mercado Centro',
        confidence: 0.92,
        warnings: [],
      },
      attempts: 1,
    }),
  }));

  const store = await createStore(request, 'Mercado', 'Mercado Centro');
  const listResponse = await request.post('/api/v1/shopping-lists', { data: { name: 'Compra foto' } });
  const list = (await listResponse.json()).list;

  await page.goto(`/lists/${encodeURIComponent(list.id)}`);
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await expect(page.locator('#item-scan-options')).toBeVisible();
  await expect(page.getByRole('button', { name: /Ticket/ })).toBeVisible();

  await page.getByRole('button', { name: /Producto.*Foto para autocompletar/ }).click();
  await page.locator('#product-camera').setInputFiles({
    name: 'milk.png',
    mimeType: 'image/png',
    buffer: validPng,
  });

  const productDialog = page.locator('#global-product-dialog');
  await expect(productDialog).toBeVisible();
  await expect(productDialog.locator('#global-canonical-name')).toHaveValue('Leche');
  await expect(productDialog.locator('#global-variant-name')).toHaveValue('Leche entera 1 L');
  await expect(productDialog.locator('#global-brand')).toHaveValue('Hacendado');
  await expect(productDialog.locator('#global-ean')).toHaveValue('8480000123456');
  await expect(productDialog.locator('#global-price')).toHaveValue(/1[,.]19/);
  await expect(productDialog.locator('#global-normalized-price')).toContainText('1,19');
  await expect(productDialog.locator('#global-normalized-price')).toContainText('/L');
  await expect(productDialog.locator('#global-store-select')).toHaveValue(store.id);
  await expect(productDialog.locator('#global-ai-feedback')).toBeVisible();
  await expect(productDialog.locator('#global-product-confidence')).toHaveText('92%');
  await productDialog.screenshot({ path: testInfo.outputPath('product-photo-autofill-form.png') });

  await productDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.locator('#item-dialog')).toBeVisible();
  await page.locator('#item-mode-scan').click();
  await page.locator('#scan-ticket').click();
  await expect(page).toHaveURL(/\/tickets$/u);
  expect(errors).toEqual([]);
});

test('product creation can reuse an existing canonical parent from the shopping item editor', async ({ page, request }) => {
  const parent = await createProduct(request, {
    canonicalName: 'Leche',
    variantName: 'Leche entera 1 L',
    packageMinor: 1,
    packageUnit: 'l',
  });
  const listResponse = await request.post('/api/v1/shopping-lists', { data: { name: 'Compra padres' } });
  const list = (await listResponse.json()).list;

  await page.goto(`/lists/${encodeURIComponent(list.id)}`);
  await page.getByRole('button', { name: 'Crear ítem', exact: true }).click();
  await page.getByLabel('Producto', { exact: true }).fill('Leche semidesnatada');
  await expect(page.getByRole('button', { name: /Crear nuevo producto/ })).toBeVisible();
  await page.getByRole('button', { name: /Crear nuevo producto/ }).click();

  const dialog = page.locator('#global-product-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#global-parent-search').fill('Leche');
  const parentOption = dialog.getByRole('option', { name: /Leche.*1 variantes/ });
  await expect(parentOption).toBeVisible();
  await parentOption.click();
  await expect(dialog.locator('#global-parent-selected-name')).toHaveText('Leche');
  await dialog.locator('#global-variant-name').fill('Leche semidesnatada 1 L');
  await dialog.locator('#global-package-minor').fill('1');
  await dialog.locator('#global-package-unit').selectOption('l');
  await dialog.getByRole('button', { name: 'Crear y añadir', exact: true }).click();

  await expect(page.locator('#pending-items')).toContainText('Leche semidesnatada 1 L');
  const parentsResponse = await request.get('/api/v1/products/parents?q=Leche');
  const parents = (await parentsResponse.json()).parents;
  const reused = parents.find(candidate => candidate.id === parent.canonicalProductId);
  expect(reused?.variantCount).toBe(2);
});
