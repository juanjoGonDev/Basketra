import { test, expect } from '@playwright/test';

function productFixture(id, name, updatedAt) {
  return {
    id,
    canonicalProductId: `parent_${id}`,
    canonicalName: name,
    variantName: name,
    brand: null,
    ean: null,
    packageMinor: null,
    packageUnit: null,
    categoryId: null,
    categoryName: null,
    retailerNames: [],
    latestPrices: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

function ticketFixture(id, purchasedAt, totalMinor) {
  return {
    id,
    retailerName: 'Mercado',
    storeId: null,
    storeName: null,
    declaredTotalMinor: totalMinor,
    purchasedAt,
    createdAt: purchasedAt,
    updatedAt: purchasedAt,
    paymentStatus: 'paid',
    paymentMethod: 'Tarjeta',
    notes: '',
    taxMinor: 0,
    receiptDiscountMinor: 0,
    itemCount: 1,
  };
}

async function installCommonMetadataRoutes(page) {
  await page.route('**/api/v1/meta', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ units: ['unit'] }),
  }));
  await page.route('**/api/v1/categories', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ categories: [] }),
  }));
}

async function installCategoryPaginationRoute(page) {
  await page.route('**/api/v1/categories?*', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('mode') !== 'inventory') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ categories: [] }) });
    }
    const secondPage = Number(url.searchParams.get('offset') || 0) >= 12;
    const category = secondPage
      ? { id: 'category_page_2', name: 'Categoría página 2', color: '#18715A', productCount: 0, childCount: 0 }
      : { id: 'category_page_1', name: 'Categoría página 1', color: '#18715A', productCount: 0, childCount: 0 };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ inventory: { categories: [category], total: 13, offset: secondPage ? 12 : 0, limit: 12, hasMore: !secondPage } }),
    });
  });
}

async function installStorePaginationRoute(page) {
  await page.route('**/api/v1/inventory/stores?*', route => {
    const url = new URL(route.request().url());
    const secondPage = Number(url.searchParams.get('offset') || 0) >= 12;
    const store = secondPage
      ? { id: 'store_page_2', name: 'Tienda página 2', retailerName: 'Mercado', productCount: 0, ticketCount: 0, lastActivityAt: null }
      : { id: 'store_page_1', name: 'Tienda página 1', retailerName: 'Mercado', productCount: 0, ticketCount: 0, lastActivityAt: null };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ stores: [store], total: 13, offset: secondPage ? 12 : 0, limit: 12, hasMore: !secondPage }),
    });
  });
}

test('product selection survives pagination and bulk delete sends only explicit ids', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installCommonMetadataRoutes(page);

  const first = productFixture('variant_page_1', 'Producto página 1', '2026-09-01T10:00:00.000Z');
  const second = productFixture('variant_page_2', 'Producto página 2', '2026-09-02T10:00:00.000Z');
  let preflightIds;
  let deletedIds;

  await page.route('**/api/v1/catalog?*', route => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') || 0);
    const secondPage = offset >= 12;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        catalog: {
          products: [secondPage ? second : first],
          parents: [],
          total: 13,
          offset: secondPage ? 12 : 0,
          limit: 12,
          hasMore: !secondPage,
        },
      }),
    });
  });
  await page.route('**/api/v1/catalog/products/bulk-delete-impact', route => {
    preflightIds = route.request().postDataJSON().ids;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ impact: { canDelete: true, blocked: [] } }),
    });
  });
  await page.route('**/api/v1/catalog/products/bulk-delete', route => {
    deletedIds = route.request().postDataJSON().ids;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ deletedIds }),
    });
  });

  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await page.goto('/inventory/products');
  await expect(page.getByRole('heading', { name: 'Productos', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Seleccionar productos de esta página' }).check();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar Producto página 1' })).toBeChecked();
  await expect(page.locator('#catalog-selection-count')).toHaveText('1 productos seleccionados');
  await expect(page.locator('#catalog-selection-context')).toHaveText('1 en esta página');

  await page.locator('#catalog-next').click();
  await expect(page.locator('#catalog-page')).toHaveText('2 / 2');
  await expect(page.locator('#catalog-selection-context')).toHaveText('0 en esta página · 1 en otras páginas');
  await page.getByRole('checkbox', { name: 'Seleccionar productos de esta página' }).check();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar Producto página 2' })).toBeChecked();
  await expect(page.locator('#catalog-selection-count')).toHaveText('2 productos seleccionados');
  await expect(page.locator('#catalog-selection-context')).toHaveText('1 en esta página · 1 en otras páginas');
  await page.getByRole('button', { name: 'Limpiar selección' }).click();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar Producto página 2' })).not.toBeChecked();
  await expect(page.locator('#catalog-selection-bar')).toBeHidden();
  await page.getByRole('checkbox', { name: 'Seleccionar productos de esta página' }).check();
  await page.locator('#catalog-prev').click();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar productos de esta página' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Seleccionar productos de esta página' }).check();

  await page.locator('.view[data-view="catalog"]').screenshot({ path: testInfo.outputPath('product-selection-pagination.png') });

  await page.getByRole('button', { name: 'Eliminar seleccionados' }).click();
  await expect.poll(() => preflightIds).toEqual(['variant_page_1', 'variant_page_2']);
  const dialog = page.locator('#catalog-delete-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#catalog-delete-impact')).toContainText('2 productos');
  await expect(dialog.getByRole('button', { name: 'Eliminar producto' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Eliminar producto' }).click();
  await expect.poll(() => deletedIds).toEqual(['variant_page_1', 'variant_page_2']);
  await expect(dialog).toBeHidden();
  await expect(page.locator('#catalog-selection-bar')).toBeHidden();
  await expect(page.locator('#catalog-state')).toHaveText('2 productos eliminados.');
  expect(runtimeErrors).toEqual([]);
});

test('ticket selection survives pagination and one bulk transaction receives every explicit id', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installCommonMetadataRoutes(page);

  const first = ticketFixture('ticket_page_1', '2026-09-01T18:30:00.000Z', 150);
  const second = ticketFixture('ticket_page_2', '2026-09-02T18:30:00.000Z', 250);
  let preflightIds;
  let deletedIds;

  await page.route('**/api/v1/inventory/stores?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ stores: [], total: 0, offset: 0, limit: 100, hasMore: false }),
  }));
  await page.route('**/api/v1/inventory/tickets?*', route => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') || 0);
    const secondPage = offset >= 12;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tickets: [secondPage ? second : first],
        total: 13,
        offset: secondPage ? 12 : 0,
        limit: 12,
        hasMore: !secondPage,
        summary: {
          ticketCount: 13,
          totalSpentMinor: 400,
          itemCount: 13,
          averageTicketMinor: 200,
        },
      }),
    });
  });
  await page.route('**/api/v1/inventory/tickets/bulk-delete-impact', route => {
    preflightIds = route.request().postDataJSON().ids;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        impact: {
          ticketCount: 2,
          itemCount: 2,
          captures: 2,
          extractions: 2,
          corrections: 0,
          externalEvidence: 2,
          retainedPriceObservations: 2,
          canDelete: true,
        },
      }),
    });
  });
  await page.route('**/api/v1/inventory/tickets/bulk-delete', route => {
    deletedIds = route.request().postDataJSON().ids;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ deletedIds }),
    });
  });

  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await page.goto('/tickets/history');
  await expect(page.getByRole('heading', { name: 'Historial de tickets' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Seleccionar tickets de esta página' }).check();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar ticket ticket_page_1' })).toBeChecked();
  await expect(page.locator('#ticket-history-selection-count')).toHaveText('1 tickets seleccionados');
  await expect(page.locator('#ticket-history-selection-context')).toHaveText('1 en esta página');

  await page.locator('#ticket-history-next').click();
  await expect(page.locator('#ticket-history-page')).toHaveText('2 / 2');
  await expect(page.locator('#ticket-history-selection-context')).toHaveText('0 en esta página · 1 en otras páginas');
  await page.getByRole('checkbox', { name: 'Seleccionar tickets de esta página' }).check();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar ticket ticket_page_2' })).toBeChecked();
  await expect(page.locator('#ticket-history-selection-count')).toHaveText('2 tickets seleccionados');
  await expect(page.locator('#ticket-history-selection-context')).toHaveText('1 en esta página · 1 en otras páginas');
  await page.getByRole('button', { name: 'Limpiar selección' }).click();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar ticket ticket_page_2' })).not.toBeChecked();
  await expect(page.locator('#ticket-history-selection-bar')).toBeHidden();
  await page.getByRole('checkbox', { name: 'Seleccionar tickets de esta página' }).check();
  await page.locator('#ticket-history-prev').click();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar tickets de esta página' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Seleccionar tickets de esta página' }).check();

  await page.locator('.view[data-view="ticket-history"]').screenshot({ path: testInfo.outputPath('ticket-selection-pagination.png') });

  await page.getByRole('button', { name: 'Eliminar seleccionados' }).click();
  await expect.poll(() => preflightIds).toEqual(['ticket_page_1', 'ticket_page_2']);
  const dialog = page.locator('#ticket-history-delete-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#ticket-history-delete-identity')).toContainText('2 tickets seleccionados');
  await expect(dialog.getByRole('button', { name: 'Eliminar ticket y datos' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Eliminar ticket y datos' }).click();
  await expect.poll(() => deletedIds).toEqual(['ticket_page_1', 'ticket_page_2']);
  await expect(dialog).toBeHidden();
  await expect(page.locator('#ticket-history-selection-bar')).toBeHidden();
  await expect(page.locator('#ticket-history-state')).toHaveText('2 tickets eliminados.');
  expect(runtimeErrors).toEqual([]);
});

test('category and store page selection synchronize each visible checkbox across pagination and clearing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installCommonMetadataRoutes(page);
  await installCategoryPaginationRoute(page);
  await installStorePaginationRoute(page);

  await page.goto('/inventory/categories');
  await expect(page.getByRole('heading', { name: 'Categorías', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Seleccionar categorías de esta página' }).check();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar categoría Categoría página 1' })).toBeChecked();
  await page.locator('#category-next').click();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar categorías de esta página' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Seleccionar categorías de esta página' }).check();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar categoría Categoría página 2' })).toBeChecked();
  await page.getByRole('button', { name: 'Limpiar selección' }).click();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar categoría Categoría página 2' })).not.toBeChecked();

  await page.goto('/inventory/stores');
  await expect(page.getByRole('heading', { name: 'Tiendas', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Seleccionar tiendas de esta página' }).check();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar tienda Tienda página 1' })).toBeChecked();
  await page.locator('#store-next').click();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar tiendas de esta página' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Seleccionar tiendas de esta página' }).check();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar tienda Tienda página 2' })).toBeChecked();
  await page.getByRole('button', { name: 'Limpiar selección' }).click();
  await expect(page.getByRole('checkbox', { name: 'Seleccionar tienda Tienda página 2' })).not.toBeChecked();
});
