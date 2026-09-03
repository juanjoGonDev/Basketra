import { test, expect } from '@playwright/test';

const product = {
  id: 'variant_milk',
  canonicalProductId: 'parent_milk',
  canonicalName: 'Leche',
  variantName: 'Leche entera 1 L',
  brand: 'Casa',
  aliases: [],
  retailerNames: [],
  latestPrices: [],
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
};

const categories = [
  {
    id: 'category_unknown',
    name: 'desconocido',
    color: '#64748B',
    productCount: 0,
    childCount: 0,
    descendantProductCount: 0,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  },
  {
    id: 'category_food',
    name: 'Alimentación',
    color: '#118844',
    description: 'Productos alimentarios',
    productCount: 2,
    childCount: 1,
    descendantProductCount: 1,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
  },
];

const store = {
  id: 'store_central',
  retailerName: 'Mercado Central',
  name: 'Centro',
  region: 'Sevilla',
  address: 'Calle Feria 1',
  productCount: 4,
  ticketCount: 2,
  priceObservationCount: 6,
  createdAt: '2026-08-20T10:00:00.000Z',
  lastActivityAt: '2026-09-02T18:30:00.000Z',
};

async function installRoutes(page) {
  await page.route('**/api/v1/catalog?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ catalog: { products: [product], parents: [], total: 1, offset: 0, limit: 12, hasMore: false } }),
  }));
  await page.route('**/api/v1/catalog/products/variant_milk/delete-impact', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ impact: { receiptItems: 1, shoppingListItems: 0, priceObservations: 2, retailerListings: 0, linkedStores: 1, canDelete: false } }),
  }));
  await page.route(/\/api\/v1\/categories(?:\?.*)?$/, route => {
    const url = new URL(route.request().url());
    const inventory = url.searchParams.get('mode') === 'inventory';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(inventory
        ? { inventory: { categories, total: categories.length, offset: 0, limit: 12, hasMore: false } }
        : { categories }),
    });
  });
  await page.route('**/api/v1/categories/category_food/delete-impact', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ impact: { productCount: 2, childCount: 1, descendantCategoryCount: 1, descendantProductCount: 1, protected: false, canDelete: false } }),
  }));
  await page.route('**/api/v1/inventory/stores?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ stores: [store], total: 1, offset: 0, limit: 12, hasMore: false }),
  }));
  await page.route(/\/api\/v1\/inventory\/stores\/store_central$/, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ store }),
  }));
  await page.route('**/api/v1/inventory/stores/store_central/delete-impact', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ impact: { linkedProducts: 4, priceObservations: 6, historicalTickets: 2, canDelete: false } }),
  }));
}

async function openInventorySection(page, name) {
  await page.locator('.bottom-nav [data-nav="inventory"]').click();
  await page.locator('.view[data-view="inventory"]').getByRole('button', { name, exact: true }).first().click();
}

async function openAccessibleActions(wrapper) {
  const toggle = wrapper.locator('[data-swipe-toggle]');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(wrapper.locator('[data-swipe-actions]')).toHaveAttribute('aria-hidden', 'false');
}

test('inventory entity rows share accessible swipe actions and preserve canonical delete preflights', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installRoutes(page);
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()); });

  await page.goto('/#home');

  await openInventorySection(page, 'Productos');
  const productWrapper = page.locator('[data-swipe-kind="inventory-product"][data-swipe-id="variant_milk"]');
  await expect(productWrapper).toBeVisible();
  await openAccessibleActions(productWrapper);
  await productWrapper.locator('[data-inventory-row-action="edit"]').click();
  await expect(page).toHaveURL(/#catalog:variant_milk$/);
  await expect(page.locator('#catalog-editor')).toBeVisible();
  await page.locator('.view[data-view="catalog"]').screenshot({ path: testInfo.outputPath('inventory-product-editor-mobile.png') });
  await page.locator('#catalog-back-list').click();

  await openAccessibleActions(productWrapper);
  await productWrapper.locator('[data-inventory-row-action="delete"]').click();
  const productDelete = page.locator('#catalog-delete-dialog');
  await expect(productDelete).toBeVisible();
  await expect(productDelete.locator('#catalog-delete-impact')).toContainText('1 líneas de ticket');
  await expect(productDelete.locator('#catalog-delete-impact')).toContainText('2 precios históricos');
  await expect(productDelete.getByRole('button', { name: 'Eliminar producto' })).toBeDisabled();
  await page.locator('.view[data-view="catalog"]').screenshot({ path: testInfo.outputPath('inventory-product-delete-mobile.png') });
  await productDelete.getByRole('button', { name: 'Cancelar' }).click();
  await page.locator('#catalog-back-list').click();

  await openInventorySection(page, 'Categorías');
  const protectedCategory = page.locator('[data-swipe-kind="inventory-category"][data-swipe-id="category_unknown"]');
  await expect(protectedCategory).toBeVisible();
  await openAccessibleActions(protectedCategory);
  await expect(protectedCategory.locator('[data-inventory-row-action="delete"]')).toBeDisabled();
  await expect(protectedCategory).not.toHaveAttribute('data-swipe-end-action', 'delete');

  const categoryWrapper = page.locator('[data-swipe-kind="inventory-category"][data-swipe-id="category_food"]');
  await openAccessibleActions(categoryWrapper);
  await categoryWrapper.locator('[data-inventory-row-action="edit"]').click();
  await expect(page).toHaveURL(/#categories:category_food$/);
  await expect(page.locator('#category-editor')).toBeVisible();
  await page.locator('#categories-back-list').click();

  await openAccessibleActions(categoryWrapper);
  await categoryWrapper.locator('[data-inventory-row-action="delete"]').click();
  const categoryDelete = page.locator('#category-delete-dialog');
  await expect(categoryDelete).toBeVisible();
  await expect(categoryDelete.locator('#category-delete-impact')).toContainText('2 productos directos');
  await expect(categoryDelete.locator('#category-delete-impact')).toContainText('1 subcategorías directas');
  await expect(categoryDelete.getByRole('button', { name: 'Eliminar categoría' })).toBeDisabled();
  await categoryDelete.getByRole('button', { name: 'Cancelar' }).click();
  await page.locator('#categories-back-list').click();

  await openInventorySection(page, 'Tiendas');
  const storeWrapper = page.locator('[data-swipe-kind="inventory-store"][data-swipe-id="store_central"]');
  await expect(storeWrapper).toBeVisible();
  await openAccessibleActions(storeWrapper);
  await storeWrapper.locator('[data-inventory-row-action="delete"]').click();

  const storeDelete = page.locator('#store-delete-dialog');
  await expect(storeDelete).toBeVisible();
  await expect(page).toHaveURL(/#stores:store_central$/);
  await expect(storeDelete.locator('#store-delete-impact')).toContainText('4 productos vinculados');
  await expect(storeDelete.locator('#store-delete-impact')).toContainText('6 observaciones de precio');
  await expect(storeDelete.locator('#store-delete-impact')).toContainText('2 tickets históricos');
  await expect(storeDelete.getByRole('button', { name: 'Eliminar tienda' })).toBeDisabled();

  expect(runtimeErrors).toEqual([]);
});
