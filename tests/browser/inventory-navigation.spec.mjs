import { test, expect } from '@playwright/test';

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

async function installInventoryRoutes(page) {
  await page.route('**/api/v1/inventory/overview', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ overview: { productCount: 12, categoryCount: 5, storeCount: 3, latestCatalogValueMinor: 4321 } }),
  }));
  await page.route('**/api/v1/catalog?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ catalog: { products: [], parents: [], total: 0, offset: 0, limit: 12, hasMore: false } }),
  }));
  await page.route('**/api/v1/categories**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      categories: [],
      inventory: { categories: [], total: 0, offset: 0, limit: 12, hasMore: false },
    }),
  }));
  await page.route('**/api/v1/inventory/stores?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ stores: [], total: 0, offset: 0, limit: 12, hasMore: false }),
  }));
  await page.route('**/api/v1/inventory/statistics?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      statistics: {
        period: '30d',
        summary: {
          latestCatalogValueMinor: 4321,
          activeProducts: 12,
          ticketsProcessed: 0,
          entriesValueMinor: 0,
          lowStockUnavailableReason: 'Stock thresholds are not part of the current canonical inventory model.',
        },
        categoryStats: [],
        storeStats: [],
        ticketTrend: [],
      },
    }),
  }));
}

async function openInventory(page) {
  await page.goto('/#home');
  const primary = page.locator('.bottom-nav button');
  await expect(primary).toHaveCount(5);
  await expect(primary.nth(3)).toHaveText('Inventario');
  await expect(page.getByRole('button', { name: 'Planes', exact: true })).toHaveCount(0);
  await primary.nth(3).click();
  await expect(page).toHaveURL(/#inventory$/);
  await expect(page.getByRole('heading', { name: 'Inventario', exact: true })).toBeVisible();
  await expect(page.locator('#inventory-overview-state')).toHaveText('Resumen actualizado con datos persistidos.');
}

test('Inventory replaces Plans with canonical overview metrics, search handoff and entity entry points', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installInventoryRoutes(page);
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()); });

  await openInventory(page);
  const inventory = page.locator('.view[data-view="inventory"]');
  await expect(inventory.locator('#inventory-overview-products')).toHaveText('12');
  await expect(inventory.locator('#inventory-overview-categories')).toHaveText('5');
  await expect(inventory.locator('#inventory-overview-stores')).toHaveText('3');
  await expect(inventory.locator('#inventory-overview-value')).toContainText('43,21');
  await expect(inventory.locator('.inventory-overview-kpis .inventory-kpi')).toHaveCount(4);
  await expect(inventory.locator('#inventory-overview-search')).toBeVisible();
  await expect(inventory.locator('#inventory-overview-sort')).toBeHidden();
  await expect(inventory.getByRole('button', { name: 'Abrir filtros' })).toBeVisible();
  for (const section of ['Productos', 'Categorías', 'Tiendas', 'Estadísticas']) {
    await expect(inventory.getByRole('button', { name: section, exact: true }).first()).toBeVisible();
  }
  const mobileKpiColumns = await inventory.locator('.inventory-overview-kpis').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(mobileKpiColumns).toBe(2);
  await expectNoHorizontalOverflow(page);
  await inventory.screenshot({ path: testInfo.outputPath('inventory-mobile.png') });

  await inventory.getByRole('button', { name: 'Nuevo producto', exact: true }).click();
  await expect(page).toHaveURL(/#catalog:new$/);
  await expect(page.locator('#catalog-editor')).toBeVisible();
  await expect(page.locator('#catalog-canonical-name')).toBeFocused();
  await page.locator('.bottom-nav [data-nav="inventory"]').click();
  await expect(page).toHaveURL(/#inventory$/);

  await inventory.locator('#inventory-overview-search').fill('leche');
  await inventory.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page).toHaveURL(/#catalog$/);
  await expect(page.locator('#catalog-search')).toHaveValue('leche');
  await expect(page.locator('#catalog-sort')).toHaveValue('recent');
  await expect(page.locator('.bottom-nav [data-nav="inventory"]')).toHaveAttribute('aria-current', 'page');

  await page.locator('.bottom-nav [data-nav="inventory"]').click();
  await inventory.locator('[data-inventory-scope="categories"]').click();
  await inventory.locator('#inventory-overview-search').fill('lácteos');
  await inventory.getByRole('button', { name: 'Abrir filtros' }).click();
  await expect(page).toHaveURL(/#categories$/);
  await expect(page.locator('#category-search')).toHaveValue('lácteos');
  await expect(page.locator('#category-filter')).toBeFocused();

  await page.locator('.bottom-nav [data-nav="inventory"]').click();
  await inventory.locator('[data-inventory-scope="stores"]').click();
  await inventory.locator('#inventory-overview-search').fill('centro');
  await inventory.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page).toHaveURL(/#stores$/);
  await expect(page.locator('#store-search')).toHaveValue('centro');
  await expect(page.locator('#store-sort')).toHaveValue('name');

  await page.locator('.bottom-nav [data-nav="inventory"]').click();
  await inventory.getByRole('button', { name: 'Estadísticas', exact: true }).first().click();
  await expect(page).toHaveURL(/#inventory-statistics$/);
  await expect(page.getByRole('heading', { name: 'Estadísticas', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(runtimeErrors).toEqual([]);
});

test('Inventory overview preserves the approved desktop hierarchy without horizontal overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installInventoryRoutes(page);

  await page.goto('/#inventory');
  await expect(page.getByRole('heading', { name: 'Inventario', exact: true })).toBeVisible();
  await expect(page.locator('#inventory-overview-state')).toHaveText('Resumen actualizado con datos persistidos.');
  await expect(page.locator('.inventory-overview-kpis .inventory-kpi')).toHaveCount(4);
  await expect(page.locator('.inventory-overview-query')).toBeVisible();
  await expect(page.locator('.inventory-overview-cards .dashboard-card')).toHaveCount(4);
  await expect(page.locator('.inventory-overview-guidance')).toContainText('Datos canónicos');
  await expectNoHorizontalOverflow(page);
  await page.locator('.view[data-view="inventory"]').screenshot({ path: testInfo.outputPath('inventory-desktop.png') });
});
