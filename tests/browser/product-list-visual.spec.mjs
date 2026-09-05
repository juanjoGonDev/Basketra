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

const priceHistory = [
  { id: 'price_2', productVariantId: 'variant_milk', retailerId: 'retailer_mercadona', retailerName: 'Mercadona', storeId: 'store_centro', storeName: 'Mercadona Centro', priceMinor: 119, packageNumerator: 1, packageDenominator: 1, packageUnit: 'unit', normalizedPriceNumerator: 119, normalizedPriceDenominator: 1, evidenceId: 'evidence_2', observedAt: '2026-08-31T10:00:00.000Z', confidence: 1 },
  { id: 'price_1', productVariantId: 'variant_milk', retailerId: 'retailer_mercadona', retailerName: 'Mercadona', storeId: 'store_centro', storeName: 'Mercadona Centro', priceMinor: 109, packageNumerator: 1, packageDenominator: 1, packageUnit: 'unit', normalizedPriceNumerator: 109, normalizedPriceDenominator: 1, evidenceId: 'evidence_1', observedAt: '2026-07-31T10:00:00.000Z', confidence: 1 },
];

const ticketHistory = [
  { receiptId: 'receipt_milk_august', purchasedAt: '2026-08-31T10:00:00.000Z', retailerName: 'Mercadona', storeName: 'Mercadona Centro', quantity: 2, unit: 'unit', lineTotalMinor: 238 },
  { receiptId: 'receipt_milk_july', purchasedAt: '2026-07-31T10:00:00.000Z', retailerName: 'Mercadona', quantity: 1, unit: 'unit', lineTotalMinor: 109 },
];

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
  await page.route('**/api/v1/products/variant_milk', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ product, priceHistory, ticketHistory }),
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

test('product list opens a full-page product detail with accessible price history', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installCatalogRoutes(page);

  await page.goto('/inventory/products');
  await expect(page.getByRole('heading', { name: 'Productos', exact: true })).toBeVisible();
  await expect(page.locator('#catalog-range')).toHaveText('1-1 de 1');
  await expect(page.locator('#catalog-list-screen .inventory-list-heading')).toBeVisible();

  const row = page.locator('#catalog-products .inventory-product-row');
  await expect(row).toContainText('Leche entera 1 L');
  await expect(row).toContainText('Lácteos');
  await expect(row).toContainText('1,19');
  await page.locator('.view[data-view="catalog"]').screenshot({ path: testInfo.outputPath('catalog-product-list-desktop.png') });
  await row.click();

  await expect(page.locator('#catalog-list-screen')).toBeHidden();
  const detail = page.locator('#catalog-detail');
  await expect(detail).toBeVisible();
  await expect(page.locator('#catalog-back-list')).toBeVisible();
  await expect(page.locator('#catalog-detail-name')).toHaveText('Leche entera 1 L');
  await expect(page.locator('#catalog-detail-category')).toHaveText('Lácteos');
  await expect(page.locator('#catalog-latest-prices')).toContainText('Mercadona Centro');
  await expect(page.locator('#catalog-price-history-chart')).toBeVisible();
  await expect(page.locator('#catalog-price-history-table')).toContainText('Mercadona Centro');
  await expect(page.locator('#catalog-price-history-table')).toContainText('1,09');
  await expect(page.locator('#catalog-ticket-history')).toBeVisible();
  await expect(page.locator('#catalog-ticket-history-table')).toContainText('Mercadona Centro');
  await expect(page.locator('#catalog-ticket-history-table')).toContainText('2');

  const geometry = await detail.evaluate(element => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      viewport: document.documentElement.clientWidth,
    };
  });
  expect(geometry.right - geometry.left).toBeGreaterThan(700);
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole('link', { name: /Abrir ticket del 31 ago 2026/i })).toHaveAttribute('href', '/tickets/history/receipt_milk_august');

  await page.locator('.view[data-view="catalog"]').screenshot({ path: testInfo.outputPath('catalog-product-detail-desktop.png') });
});

test('product ticket history has an explicit empty state without mobile overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installCatalogRoutes(page);
  await page.route('**/api/v1/products/variant_milk', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ product, priceHistory, ticketHistory: [] }),
  }));

  await page.goto('/inventory/products/variant_milk');
  await expect(page.locator('#catalog-detail')).toBeVisible();
  await expect(page.locator('#catalog-ticket-history-state')).toHaveText('Todavía no hay tickets confirmados que contengan este producto.');
  await expect(page.locator('#catalog-ticket-history-content')).toBeHidden();
  await expectNoHorizontalOverflow(page);
});

test('product history exposes an explicit error state when its read model is unavailable', async ({ page }) => {
  await installCatalogRoutes(page);
  await page.route('**/api/v1/products/variant_milk', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: { message: 'Servicio no disponible' } }),
  }));

  await page.goto('/inventory/products/variant_milk');
  await expect(page.locator('#catalog-detail-title')).toHaveText('No se pudo abrir el producto');
  await expect(page.locator('#catalog-ticket-history-state')).toContainText('No se pudo cargar el historial de tickets');
});
