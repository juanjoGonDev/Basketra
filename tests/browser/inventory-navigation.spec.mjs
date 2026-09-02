import { test, expect } from '@playwright/test';

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

test('Inventory replaces Plans and owns products, categories, stores and statistics', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()); });

  await page.route('**/api/v1/catalog?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ catalog: { products: [], parents: [], offset: 0, limit: 100, hasMore: false } }) }));
  await page.route('**/api/v1/categories', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ categories: [] }) }));

  await page.goto('/#home');
  const primary = page.locator('.bottom-nav button');
  await expect(primary).toHaveCount(5);
  await expect(primary.nth(3)).toHaveText('Inventario');
  await expect(page.getByRole('button', { name: 'Planes', exact: true })).toHaveCount(0);

  await primary.nth(3).click();
  await expect(page).toHaveURL(/#inventory$/);
  await expect(page.getByRole('heading', { name: 'Inventario', exact: true })).toBeVisible();
  const inventory = page.locator('.view[data-view="inventory"]');
  for (const section of ['Productos', 'Categorías', 'Tiendas', 'Estadísticas']) {
    await expect(inventory.getByRole('button', { name: section, exact: true }).first()).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);
  await inventory.screenshot({ path: testInfo.outputPath('inventory-mobile.png') });

  await inventory.getByRole('button', { name: 'Productos', exact: true }).first().click();
  await expect(page).toHaveURL(/#catalog$/);
  await expect(page.locator('.bottom-nav [data-nav="inventory"]')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Inventario', exact: true }).first().click();

  await inventory.getByRole('button', { name: 'Categorías', exact: true }).first().click();
  await expect(page).toHaveURL(/#categories$/);
  await expect(page.locator('.bottom-nav [data-nav="inventory"]')).toHaveAttribute('aria-current', 'page');
  await page.locator('.bottom-nav [data-nav="inventory"]').click();

  await inventory.getByRole('button', { name: 'Tiendas', exact: true }).first().click();
  await expect(page).toHaveURL(/#stores$/);
  await expect(page.getByRole('heading', { name: 'Tiendas', exact: true })).toBeVisible();
  await page.locator('.bottom-nav [data-nav="inventory"]').click();

  await inventory.getByRole('button', { name: 'Estadísticas', exact: true }).first().click();
  await expect(page).toHaveURL(/#inventory-statistics$/);
  await expect(page.getByRole('heading', { name: 'Estadísticas', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  expect(runtimeErrors).toEqual([]);
});
