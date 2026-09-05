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
