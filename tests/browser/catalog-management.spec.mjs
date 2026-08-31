import { test, expect } from '@playwright/test';

const product = {
  id: 'variant_milk',
  canonicalProductId: 'parent_milk',
  canonicalName: 'Leche',
  variantName: 'Leche entera 1 L',
  brand: 'Casa',
  aliases: ['leche casa'],
  retailerNames: [
    {
      listingId: 'listing_mercadona',
      retailerId: 'retailer_mercadona',
      retailerName: 'Mercadona',
      title: 'Leche entera Hacendado 1 L',
    },
  ],
  createdAt: '2026-08-31T10:00:00.000Z',
  updatedAt: '2026-08-31T10:00:00.000Z',
};

const catalog = {
  products: [product],
  parents: [
    { id: 'parent_milk', name: 'Leche', variantCount: 1 },
    { id: 'parent_dairy', name: 'Lácteos', variantCount: 2 },
  ],
  offset: 0,
  limit: 50,
  hasMore: false,
};

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

test('saved catalog products can be browsed, edited and related on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let productPatch;
  let parentRelation;
  let retailerRelation;

  await page.route('**/api/v1/catalog?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ catalog }),
  }));
  await page.route('**/api/v1/products/variant_milk', route => {
    if (route.request().method() === 'PATCH') productPatch = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ product }) });
  });
  await page.route('**/api/v1/catalog/products/variant_milk/parent', route => {
    parentRelation = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ relation: { productVariantId: product.id, canonicalProductId: parentRelation.canonicalProductId || 'parent_new' } }),
    });
  });
  await page.route('**/api/v1/catalog/products/variant_milk/retailer-name', route => {
    retailerRelation = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ retailerName: { listingId: 'listing_new', retailerId: 'retailer_lidl', ...retailerRelation } }),
    });
  });

  await page.goto('/#home');
  const catalogEntry = page.getByRole('button', { name: /Productos guardados/i });
  await expect(catalogEntry).toBeVisible();
  await catalogEntry.click();

  await expect(page).toHaveURL(/#catalog$/);
  await expect(page.getByRole('heading', { name: 'Productos guardados', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Leche entera 1 L/ })).toBeVisible();
  await page.getByRole('button', { name: /Leche entera 1 L/ }).click();

  await expect(page.locator('#catalog-detail')).toBeVisible();
  await expect(page.locator('#catalog-canonical-name')).toHaveValue('Leche');
  await expect(page.getByText('Mercadona', { exact: true })).toBeVisible();
  await expect(page.getByText('Leche entera Hacendado 1 L', { exact: true })).toBeVisible();

  const saveProduct = page.getByRole('button', { name: 'Guardar ficha' });
  await page.locator('#catalog-canonical-name').fill('Leche fresca');
  await saveProduct.click();
  await expect.poll(() => productPatch?.canonicalName).toBe('Leche fresca');
  await expect(saveProduct).toBeEnabled();

  await page.locator('#catalog-parent-select').selectOption('parent_dairy');
  await page.getByRole('button', { name: 'Relacionar con el padre elegido' }).click();
  await expect.poll(() => parentRelation?.canonicalProductId).toBe('parent_dairy');

  await page.locator('#catalog-retailer-name').fill('Lidl');
  await page.locator('#catalog-retailer-title').fill('Leche fresca Milbona 1 L');
  await page.getByRole('button', { name: 'Guardar nombre del comercio' }).click();
  await expect.poll(() => retailerRelation).toEqual({ retailerName: 'Lidl', title: 'Leche fresca Milbona 1 L' });

  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('catalog-mobile.png'), fullPage: true });
});

test('receipt line total is read-only, backend-derived and ignores stale calculations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = [];
  let releaseFirstRequest;
  let markFirstRequestStarted;
  let markFirstRequestFinished;
  const firstRequestGate = new Promise(resolve => { releaseFirstRequest = resolve; });
  const firstRequestStarted = new Promise(resolve => { markFirstRequestStarted = resolve; });
  const firstRequestFinished = new Promise(resolve => { markFirstRequestFinished = resolve; });

  await page.route('**/api/v1/receipts/calculate-line', async route => {
    const payload = route.request().postDataJSON();
    requests.push(payload);
    if (requests.length === 1) {
      markFirstRequestStarted();
      await firstRequestGate;
      try {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ lineTotalMinor: 111 }),
        });
      } catch {
        // A newer edit is expected to abort this transport.
      } finally {
        markFirstRequestFinished();
      }
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ lineTotalMinor: 777 }),
    });
  });

  await page.goto('/#home');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir línea', exact: true }).click();

  const editor = page.locator('#receipt-line-dialog');
  if (!(await editor.isVisible())) await page.locator('.receipt-line-compact').last().click();
  await expect(editor).toBeVisible();
  const quantity = editor.locator('[data-field="quantity"]');
  const unitPrice = editor.locator('[data-field="unitPriceEuro"]');
  const discount = editor.locator('[data-field="discountEuro"]');
  const total = editor.locator('[data-field="lineTotalEuro"]');
  await expect(total).toBeVisible();
  await expect(total).toHaveJSProperty('readOnly', true);

  await quantity.fill('1');
  await unitPrice.fill('1.25');
  await discount.fill('0.20');
  await firstRequestStarted;

  await quantity.fill('2');
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);
  await expect(total).toHaveValue('7.77');
  await expect.poll(() => requests.at(-1)).toEqual({ quantity: 2, unitPriceMinor: 125, discountMinor: 20 });

  releaseFirstRequest();
  await firstRequestFinished;
  await expect(total).toHaveValue('7.77');
  await expect(total).toHaveAttribute('aria-readonly', 'true');
});
