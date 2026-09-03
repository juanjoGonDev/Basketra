import { test, expect } from '@playwright/test';

const product = {
  id: 'variant_milk',
  canonicalProductId: 'parent_milk',
  canonicalName: 'Leche',
  variantName: 'Leche entera 1 L',
  categoryId: 'category_dairy',
  categoryName: 'Lácteos',
  brand: 'Casa',
  ean: '8412345678901',
  aliases: ['leche casa'],
  retailerNames: [
    {
      listingId: 'listing_mercadona',
      retailerId: 'retailer_mercadona',
      retailerName: 'Mercadona',
      title: 'Leche entera Hacendado 1 L',
    },
  ],
  latestPrices: [
    {
      retailerId: 'retailer_mercadona',
      retailerName: 'Mercadona',
      storeId: 'store_centro',
      storeName: 'Mercadona Centro',
      priceMinor: 119,
      observedAt: '2026-08-31T10:00:00.000Z',
      confidence: 1,
    },
  ],
  createdAt: '2026-08-31T10:00:00.000Z',
  updatedAt: '2026-08-31T10:00:00.000Z',
};

async function installCatalogRoutes(page) {
  await page.route('**/api/v1/meta', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ units: ['unit', 'ml', 'g'] }),
  }));
  await page.route('**/api/v1/categories', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ categories: [{ id: 'category_dairy', name: 'Lácteos' }] }),
  }));
  await page.route('**/api/v1/catalog?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      catalog: {
        products: [product],
        parents: [{ id: 'parent_milk', name: 'Leche', categoryId: 'category_dairy', categoryName: 'Lácteos', variantCount: 1 }],
        total: 1,
        offset: 0,
        limit: 12,
        hasMore: false,
      },
    }),
  }));
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

test('product list preserves the approved desktop table and contextual preview hierarchy', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installCatalogRoutes(page);

  await page.goto('/#catalog');
  await expect(page.getByRole('heading', { name: 'Productos', exact: true })).toBeVisible();
  await expect(page.locator('#catalog-range')).toHaveText('1-1 de 1');
  await expect(page.locator('#catalog-list-screen .inventory-list-heading')).toBeVisible();

  const row = page.locator('#catalog-products .inventory-product-row');
  await expect(row).toContainText('Leche entera 1 L');
  await expect(row).toContainText('Lácteos');
  await expect(row).toContainText('1,19');
  await row.click();

  await expect(page.locator('#catalog-list-screen')).toBeVisible();
  await expect(page.locator('#catalog-detail')).toBeVisible();
  await expect(page.locator('#catalog-detail-name')).toHaveText('Leche entera 1 L');
  await expect(page.locator('#catalog-detail-category')).toHaveText('Lácteos');
  await expect(page.locator('#catalog-latest-prices')).toContainText('Mercadona Centro');

  const geometry = await page.locator('.view[data-view="catalog"]').evaluate(element => {
    const listScreen = element.querySelector('#catalog-list-screen');
    const detail = element.querySelector('#catalog-detail');
    const toolbar = listScreen.querySelector('.inventory-toolbar');
    const listSurface = listScreen.querySelector('.inventory-list-surface');
    const header = listScreen.querySelector('.inventory-entity-header');
    const list = listScreen.getBoundingClientRect();
    const detailBox = detail.getBoundingClientRect();
    const headerBox = header.getBoundingClientRect();
    return {
      listRight: list.right,
      detailLeft: detailBox.left,
      detailWidth: detailBox.width,
      headerRight: headerBox.right,
      toolbarClientWidth: toolbar.clientWidth,
      toolbarScrollWidth: toolbar.scrollWidth,
      listSurfaceClientWidth: listSurface.clientWidth,
      listSurfaceScrollWidth: listSurface.scrollWidth,
    };
  });
  expect(geometry.detailLeft).toBeGreaterThanOrEqual(geometry.listRight - 2);
  expect(geometry.detailWidth).toBeGreaterThan(240);
  expect(geometry.headerRight).toBeLessThanOrEqual(geometry.listRight + 1);
  expect(geometry.toolbarScrollWidth).toBeLessThanOrEqual(geometry.toolbarClientWidth);
  expect(geometry.listSurfaceScrollWidth).toBeLessThanOrEqual(geometry.listSurfaceClientWidth);
  await expectNoHorizontalOverflow(page);

  await page.locator('.view[data-view="catalog"]').screenshot({ path: testInfo.outputPath('catalog-desktop-preview.png') });
});
