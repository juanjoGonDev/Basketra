import { test, expect } from '@playwright/test';

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

const catalogProduct = {
  id: 'variant_receipt_demo',
  canonicalProductId: 'product_receipt_demo',
  canonicalName: 'Bebida coco 0% A',
  variantName: 'Bebida coco 0% A',
  aliases: [],
  retailerNames: [{
    listingId: 'listing_receipt_demo',
    retailerId: 'retailer_alcampo',
    retailerName: 'Alcampo',
    title: 'BEBIDA COCO 0% A',
  }],
  latestPrices: [{
    retailerId: 'retailer_alcampo',
    retailerName: 'Alcampo',
    priceMinor: 88,
    observedAt: '2026-09-01T12:00:00.000Z',
    confidence: 1,
  }],
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
};

test('ticket-derived catalog shows retailer prices on desktop', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/v1/catalog?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      catalog: {
        products: [catalogProduct],
        parents: [{ id: 'product_receipt_demo', name: 'Bebida coco 0% A', variantCount: 1 }],
        total: 1,
        offset: 0,
        limit: 50,
        hasMore: false,
      },
    }),
  }));

  await page.route('**/api/v1/products/variant_receipt_demo', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ product: catalogProduct, priceHistory: [] }),
  }));

  await page.goto('/');
  await page.getByRole('button', { name: 'Inventario', exact: true }).first().click();
  await page.locator('.view[data-view="inventory"]').getByRole('button', { name: 'Productos', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Productos', exact: true })).toBeVisible();
  const row = page.locator('[data-catalog-product-id="variant_receipt_demo"]');
  await expect(row).toContainText('0,88');
  await row.click();
  await expect(page.locator('#catalog-latest-prices')).toContainText('Alcampo');
  await expect(page.locator('#catalog-latest-prices')).toContainText('0,88');
  await expectNoHorizontalOverflow(page);

  const shell = page.locator('.app-header, .bottom-nav, .skip-link');
  const hidden = await shell.evaluateAll(elements => elements.map(element => element.hidden));
  await shell.evaluateAll(elements => elements.forEach(element => { element.hidden = true; }));
  try {
    await page.locator('.view[data-view="catalog"]').screenshot({ path: testInfo.outputPath('catalog-ticket-desktop.png') });
  } finally {
    await shell.evaluateAll((elements, previous) => {
      elements.forEach((element, index) => { element.hidden = previous[index]; });
    }, hidden);
  }
});


test('inventory product compares latest store prices and appends manual updates responsively', async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 390, height: 844 });
  let pricePosts = 0;
  let storeReads = 0;
  let refreshed = false;
  const north = { id: 'store_north', retailerId: 'retailer_market', retailerName: 'Mercado', name: 'Norte' };
  const south = { id: 'store_south', retailerId: 'retailer_market', retailerName: 'Mercado', name: 'Sur' };
  const initial = {
    ...catalogProduct,
    id: 'variant_compare',
    canonicalProductId: 'product_compare',
    canonicalName: 'Arroz',
    variantName: 'Arroz largo 1 kg',
    latestPricesTruncated: true,
    latestPrices: [
      { retailerId: 'retailer_market', retailerName: 'Mercado', storeId: south.id, storeName: south.name, priceMinor: 110, observedAt: '2026-09-02T10:00:00.000Z', confidence: 1 },
      { retailerId: 'retailer_market', retailerName: 'Mercado', storeId: north.id, storeName: north.name, priceMinor: 125, observedAt: '2026-09-03T10:00:00.000Z', confidence: 1 },
      { retailerId: 'retailer_market', retailerName: 'Mercado', priceMinor: 130, observedAt: '2026-09-04T10:00:00.000Z', confidence: 1 },
    ],
  };
  const updated = {
    ...initial,
    latestPrices: [
      { retailerId: 'retailer_market', retailerName: 'Mercado', storeId: north.id, storeName: north.name, priceMinor: 105, observedAt: '2026-09-07T12:00:00.000Z', confidence: 1 },
      initial.latestPrices[0],
      initial.latestPrices[2],
    ],
  };

  await page.route('**/api/v1/catalog?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      catalog: {
        products: [refreshed ? updated : initial],
        parents: [{ id: 'product_compare', name: 'Arroz', variantCount: 1 }],
        total: 1,
        offset: 0,
        limit: 12,
        hasMore: false,
      },
    }),
  }));
  await page.route('**/api/v1/products/variant_compare', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      product: refreshed ? updated : initial,
      priceHistory: refreshed
        ? [{ id: 'obs_new', retailerName: 'Mercado', storeId: north.id, storeName: north.name, priceMinor: 105, observedAt: '2026-09-07T12:00:00.000Z' }]
        : [],
      ticketHistory: [],
    }),
  }));
  await page.route('**/api/v1/inventory/stores?*', route => {
    storeReads += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        stores: storeReads === 1 ? [south] : [north, south],
        total: 101,
        offset: 0,
        limit: 100,
        hasMore: true,
      }),
    });
  });
  await page.route('**/api/v1/products/variant_compare/prices', async route => {
    pricePosts += 1;
    if (pricePosts === 2) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'PRICE_WRITE_UNAVAILABLE', message: 'No se pudo guardar el precio' } }),
      });
    }
    const body = route.request().postDataJSON();
    expect(body).toEqual({
      retailerName: 'Mercado',
      storeId: north.id,
      priceMinor: 105,
      evidenceType: 'manual',
    });
    await new Promise(resolve => setTimeout(resolve, 120));
    refreshed = true;
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ observation: { id: 'obs_new', ...body, observedAt: '2026-09-07T12:00:00.000Z' } }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Inventario', exact: true }).first().click();
  await page.locator('.view[data-view="inventory"]').getByRole('button', { name: 'Productos', exact: true }).first().click();
  const catalogRow = page.locator('[data-catalog-product-id="variant_compare"]');
  await expect(catalogRow).toContainText('1,30');
  await catalogRow.click();

  const comparison = page.locator('#catalog-latest-prices .catalog-price-comparison-row');
  await expect(comparison).toHaveCount(3);
  await expect(comparison.nth(0)).toContainText('Mercado · Sur');
  await expect(comparison.nth(0)).toContainText('Más barato');
  await expect(comparison.nth(0)).toContainText('1,10');
  await expect(comparison.nth(1)).toContainText('Mercado · Norte');
  await expect(comparison.nth(2)).toContainText('sin tienda física');
  await expect(comparison.nth(2).getByRole('button', { name: 'Actualizar' })).toHaveCount(0);
  await expect(page.locator('#catalog-latest-prices')).toContainText('100 tiendas');
  await expectNoHorizontalOverflow(page);

  await comparison.nth(1).getByRole('button', { name: 'Actualizar' }).click();
  const dialog = page.locator('#catalog-price-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Actualizar precio' })).toBeVisible();
  await expect(dialog.locator('#catalog-price-store')).toHaveValue(north.id);
  await expect(dialog.locator('#catalog-price-store option:checked')).toHaveText('Mercado · Norte');
  await expect(dialog.locator('#catalog-price-value')).toHaveValue('1.25');
  await expect(dialog.locator('#catalog-price-store-help')).toContainText('primeras 100 tiendas');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  await page.locator('#catalog-add-price').click();
  await expect(dialog.getByRole('heading', { name: 'Añadir precio' })).toBeVisible();
  await dialog.locator('#catalog-price-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await expect(dialog.locator('#catalog-price-state')).toContainText('Selecciona una tienda válida');

  await dialog.locator('#catalog-price-store').selectOption(north.id);
  await dialog.locator('#catalog-price-value').fill('abc');
  await dialog.locator('#catalog-price-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await expect(dialog.locator('#catalog-price-state')).toContainText('hasta dos decimales');

  await dialog.locator('#catalog-price-value').fill('0');
  await dialog.getByRole('button', { name: 'Guardar precio' }).click();
  await expect(dialog.locator('#catalog-price-state')).toContainText('mayor que 0,00');

  await dialog.locator('#catalog-price-value').fill('1,05');
  await dialog.locator('#catalog-price-form').evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect.poll(() => pricePosts).toBe(1);
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#catalog-latest-prices .catalog-price-comparison-row').nth(0)).toContainText('Mercado · Norte');
  await expect(page.locator('#catalog-latest-prices .catalog-price-comparison-row').nth(0)).toContainText('1,05');
  await expect(page.locator('#catalog-price-history-count')).toHaveText('1');

  await page.locator('#catalog-latest-prices .catalog-price-comparison-row').nth(1).getByRole('button', { name: 'Actualizar' }).click();
  await dialog.locator('#catalog-price-value').fill('1,20');
  await dialog.getByRole('button', { name: 'Guardar precio' }).click();
  await expect.poll(() => pricePosts).toBe(2);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#catalog-price-state')).toContainText('No se pudo guardar el precio');

  await page.setViewportSize({ width: 320, height: 700 });
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('catalog-store-price-comparison-320.png'), fullPage: true });
});

test('inventory quick price editor handles empty and unavailable store inventories', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let storeMode = 'empty';
  await page.route('**/api/v1/catalog?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ catalog: { products: [catalogProduct], parents: [], total: 1, offset: 0, limit: 12, hasMore: false } }),
  }));
  await page.route('**/api/v1/products/variant_receipt_demo', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ product: catalogProduct, priceHistory: [], ticketHistory: [] }),
  }));
  await page.route('**/api/v1/inventory/stores?*', route => {
    if (storeMode === 'failure') {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'STORE_READ_UNAVAILABLE', message: 'Tiendas no disponibles' } }),
      });
    }
    if (storeMode === 'single') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          stores: [{ id: 'store_single', retailerId: 'retailer_single', retailerName: 'Mercado', name: 'Centro' }],
          total: 1,
          offset: 0,
          limit: 100,
          hasMore: false,
        }),
      });
    }
    if (storeMode === 'invalid') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ stores: null, total: 0, offset: 0, limit: 100, hasMore: false }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ stores: [], total: 0, offset: 0, limit: 100, hasMore: false }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Inventario', exact: true }).first().click();
  await page.locator('.view[data-view="inventory"]').getByRole('button', { name: 'Productos', exact: true }).first().click();
  await page.locator('[data-catalog-product-id="variant_receipt_demo"]').click();

  await page.locator('#catalog-add-price').click();
  const dialog = page.locator('#catalog-price-dialog');
  await expect(dialog.locator('#catalog-price-store-help')).toContainText('No hay tiendas guardadas');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  storeMode = 'single';
  await page.locator('#catalog-add-price').click();
  await expect(dialog.locator('#catalog-price-store-help')).toContainText('nueva observación histórica');
  await expect(dialog.locator('#catalog-price-store option')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  storeMode = 'invalid';
  await page.locator('#catalog-add-price').click();
  await expect(dialog.locator('#catalog-price-store-help')).toContainText('No hay tiendas guardadas');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  storeMode = 'failure';
  await page.locator('#catalog-add-price').click();
  await expect(dialog.locator('#catalog-price-store-help')).toContainText('No se pudieron cargar las tiendas');
  await expect(dialog.locator('#catalog-price-state')).toContainText('Tiendas no disponibles');
  await expect(dialog.locator('#catalog-price-save')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await page.locator('#catalog-back-list').click();
  await page.locator('#catalog-new-product').click();
  await expect(page.locator('#catalog-price-comparison-card')).toBeHidden();
  await page.locator('#catalog-add-price').evaluate(button => button.click());
  await expect(dialog).not.toBeVisible();
});

test('inventory price comparison covers deterministic equal-price tie breakers and missing store names', async ({ page }) => {
  const tiedProduct = {
    ...catalogProduct,
    id: 'variant_ties',
    canonicalProductId: 'product_ties',
    canonicalName: 'Pasta',
    variantName: 'Pasta 500 g',
    latestPrices: [],
  };
  let mode = 'retailer';
  const pricesByMode = {
    retailer: [
      { retailerId: 'retailer_zulu', retailerName: 'Zulu', storeId: 'store_zulu', storeName: 'Central', priceMinor: 100, observedAt: '2026-09-01T10:00:00.000Z', confidence: 1 },
      { retailerId: 'retailer_alpha', retailerName: 'Alpha', storeId: 'store_alpha', storeName: 'Central', priceMinor: 100, observedAt: '2026-09-01T10:00:00.000Z', confidence: 1 },
    ],
    store: [
      { retailerId: 'retailer_alpha', retailerName: 'Alpha', storeId: 'store_b', storeName: 'B', priceMinor: 100, observedAt: '2026-09-01T10:00:00.000Z', confidence: 1 },
      { retailerId: 'retailer_alpha', retailerName: 'Alpha', storeId: 'store_a', storeName: 'A', priceMinor: 100, observedAt: '2026-09-01T10:00:00.000Z', confidence: 1 },
    ],
    date: [
      { retailerId: 'retailer_alpha', retailerName: 'Alpha', storeId: 'store_old', storeName: 'Central', priceMinor: 100, observedAt: '2026-09-01T10:00:00.000Z', confidence: 1 },
      { retailerId: 'retailer_alpha', retailerName: 'Alpha', storeId: 'store_new', storeName: 'Central', priceMinor: 100, observedAt: '2026-09-02T10:00:00.000Z', confidence: 1 },
    ],
    unnamedLeft: [
      { retailerId: 'retailer_alpha', retailerName: 'Alpha', storeId: 'store_named', storeName: 'Central', priceMinor: 100, observedAt: '2026-09-01T10:00:00.000Z', confidence: 1 },
      { retailerId: 'retailer_alpha', retailerName: 'Alpha', storeId: 'store_unnamed', priceMinor: 100, observedAt: '2026-09-01T10:00:00.000Z', confidence: 1 },
    ],
    unnamedRight: [
      { retailerId: 'retailer_alpha', retailerName: 'Alpha', storeId: 'store_unnamed', priceMinor: 100, observedAt: '2026-09-01T10:00:00.000Z', confidence: 1 },
      { retailerId: 'retailer_alpha', retailerName: 'Alpha', storeId: 'store_named', storeName: 'Central', priceMinor: 100, observedAt: '2026-09-01T10:00:00.000Z', confidence: 1 },
    ],
  };

  await page.route('**/api/v1/catalog?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ catalog: { products: [tiedProduct], parents: [], total: 1, offset: 0, limit: 12, hasMore: false } }),
  }));
  await page.route('**/api/v1/products/variant_ties', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ product: { ...tiedProduct, latestPrices: pricesByMode[mode] }, priceHistory: [], ticketHistory: [] }),
  }));
  await page.route('**/api/v1/inventory/stores?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ stores: [], total: 0, offset: 0, limit: 100, hasMore: false }),
  }));

  await page.goto('/inventory/products/variant_ties');
  const rows = page.locator('#catalog-latest-prices .catalog-price-comparison-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Alpha');

  mode = 'store';
  await page.reload();
  await expect(rows.nth(0)).toContainText('Alpha · A');

  mode = 'date';
  await page.reload();
  await expect(rows.nth(0)).toContainText('2 sept 2026');

  mode = 'unnamedLeft';
  await page.reload();
  await expect(rows.nth(0)).toContainText('sin tienda física');

  mode = 'unnamedRight';
  await page.reload();
  await expect(rows.nth(0)).toContainText('sin tienda física');
  await rows.nth(0).getByRole('button', { name: 'Actualizar' }).click();
  const dialog = page.locator('#catalog-price-dialog');
  await expect(dialog.locator('#catalog-price-store option:checked')).toHaveText('Alpha · Tienda sin nombre');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
});
