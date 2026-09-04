import { test, expect } from '@playwright/test';

const storeFixture = {
  id: 'store_central',
  retailerName: 'Mercado Central',
  name: 'Centro',
  region: 'Sevilla',
  address: 'Calle Feria 1',
  latitudeMicrodegrees: 37392500,
  longitudeMicrodegrees: -5992500,
  osmType: 'node',
  osmId: '12345',
  productCount: 4,
  ticketCount: 2,
  priceObservationCount: 6,
  createdAt: '2026-08-20T10:00:00.000Z',
  lastActivityAt: '2026-09-02T18:30:00.000Z',
};

function statisticsFixture(period) {
  const recent = period === '90d';
  const multiplier = recent ? 2 : 1;
  return {
    summary: {
      latestCatalogValueMinor: 1250 * multiplier,
      activeProducts: 4 * multiplier,
      ticketsProcessed: 3 * multiplier,
      entriesValueMinor: 4200 * multiplier,
      lowStockUnavailableReason: 'No existe stock canónico; no se inventan existencias.',
    },
    categoryStats: [{
      id: 'category_dairy',
      name: recent ? 'Lácteos 90d' : 'Lácteos 30d',
      color: '#5D8BF4',
      productCount: 2 * multiplier,
      ticketCount: 2 * multiplier,
      spentMinor: 2100 * multiplier,
    }],
    storeStats: [{
      id: 'store_central',
      retailerName: 'Mercado Central',
      name: recent ? 'Centro 90d' : 'Centro 30d',
      productCount: 3 * multiplier,
      ticketCount: 2 * multiplier,
      spentMinor: 3000 * multiplier,
    }],
    ticketTrend: [{ date: '2026-09-02', ticketCount: 1 * multiplier, spentMinor: 1500 * multiplier }],
  };
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

async function installStoreRoutes(page) {
  let store = structuredClone(storeFixture);
  let patchPayload;

  await page.route('**/api/v1/inventory/stores?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ stores: [store], total: 1, offset: 0, limit: 12, hasMore: false }),
  }));
  await page.route(/\/api\/v1\/inventory\/stores\/store_central$/, async route => {
    if (route.request().method() === 'PATCH') {
      patchPayload = route.request().postDataJSON();
      store = { ...store, ...patchPayload, updatedAt: '2026-09-02T20:00:00.000Z' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ store }) });
  });
  await page.route('**/api/v1/inventory/stores/store_central/delete-impact', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ impact: { linkedProducts: 4, priceObservations: 6, historicalTickets: 2, canDelete: false } }),
  }));

  return { getPatch: () => patchPayload };
}

test('stores provide mobile list, editable detail and dependency-aware delete warning', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const observed = await installStoreRoutes(page);
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()); });

  await page.goto('/#home');
  await page.getByRole('button', { name: /Inventario/i }).first().click();
  const inventory = page.locator('.view[data-view="inventory"]');
  await inventory.getByRole('button', { name: 'Tiendas', exact: true }).first().click();

  await expect(page).toHaveURL(/#stores$/);
  await expect(page.getByRole('heading', { name: 'Tiendas', exact: true })).toBeVisible();
  await expect(page.locator('#store-range')).toHaveText('1-1 de 1');
  await expect(page.locator('#store-list')).toContainText('Mercado Central');
  await expect(page.locator('#store-list')).toContainText('Centro');
  await expectNoHorizontalOverflow(page);
  await page.locator('.view[data-view="stores"]').screenshot({ path: testInfo.outputPath('stores-mobile.png') });

  const storeSwipe = page.locator('[data-swipe-kind="inventory-store"][data-swipe-id="store_central"]');
  await storeSwipe.locator('[data-inventory-swipe-surface]').click();
  await expect(page).toHaveURL(/#stores:store_central$/);
  await expect(page.locator('#store-detail-name')).toHaveText('Centro');
  await expect(page.locator('#store-detail-products')).toHaveText('4');
  await expect(page.locator('#store-detail-tickets')).toHaveText('2');
  await expect(page.locator('#store-detail-prices')).toHaveText('6');

  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.locator('#store-editor')).toBeVisible();
  await page.locator('#store-name').fill('Centro renovado');
  await page.locator('#store-address').fill('Calle Feria 2');
  await page.getByRole('button', { name: 'Guardar tienda' }).click();
  await expect.poll(() => observed.getPatch()).toMatchObject({
    retailerName: 'Mercado Central',
    name: 'Centro renovado',
    region: 'Sevilla',
    address: 'Calle Feria 2',
    latitudeMicrodegrees: 37392500,
    longitudeMicrodegrees: -5992500,
    osmType: 'node',
    osmId: '12345',
  });
  await expect(page.locator('#store-detail-name')).toHaveText('Centro renovado');

  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  const dialog = page.locator('#store-delete-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#store-delete-impact')).toContainText('4 productos vinculados');
  await expect(dialog.locator('#store-delete-impact')).toContainText('6 observaciones de precio');
  await expect(dialog.locator('#store-delete-impact')).toContainText('2 tickets históricos');
  await expect(dialog.locator('#store-delete-state')).toContainText('borrado está bloqueado');
  await expect(dialog.getByRole('button', { name: 'Eliminar tienda' })).toBeDisabled();
  await expectNoHorizontalOverflow(page);
  expect(runtimeErrors).toEqual([]);
});

test('category activity bars use each canonical category color and proportional fill', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/v1/inventory/statistics?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      statistics: {
        summary: { latestCatalogValueMinor: 0, activeProducts: 2, ticketsProcessed: 1, entriesValueMinor: 300, lowStockUnavailableReason: 'No existe stock canónico.' },
        categoryStats: [
          { id: 'category_green', name: 'Verduras', color: '#118844', productCount: 1, ticketCount: 1, spentMinor: 300 },
          { id: 'category_orange', name: 'Fruta', color: '#F59E0B', productCount: 1, ticketCount: 1, spentMinor: 150 },
          { id: 'category_invalid', name: 'Sin color válido', color: 'url(javascript:alert(1))', productCount: 0, ticketCount: 0, spentMinor: 75 },
        ],
        storeStats: [{ id: 'store_central', retailerName: 'Mercado Central', name: 'Centro', productCount: 1, ticketCount: 1, spentMinor: 300 }],
        ticketTrend: [],
      },
    }),
  }));

  await page.goto('/#inventory-statistics');
  const fills = page.locator('#statistics-categories-bars .inventory-bar-fill');
  await expect(fills).toHaveCount(3);
  await expect(fills.nth(0)).toHaveCSS('--inventory-bar', '100%');
  await expect(fills.nth(1)).toHaveCSS('--inventory-bar', '50%');
  await expect(fills.nth(2)).toHaveCSS('--inventory-bar', '25%');
  await expect(fills.nth(0)).toHaveCSS('background-color', 'rgb(17, 136, 68)');
  await expect(fills.nth(1)).toHaveCSS('background-color', 'rgb(245, 158, 11)');
  await expect(fills.nth(2)).not.toHaveAttribute('style', /inventory-bar-color/);
  await expect(page.locator('#statistics-stores-bars .inventory-bar-fill')).not.toHaveAttribute('style', /inventory-bar-color/);
});

test('statistics discard an obsolete period response and expose accessible table equivalents', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  let release30d;
  let mark30dStarted;
  const gate30d = new Promise(resolve => { release30d = resolve; });
  const started30d = new Promise(resolve => { mark30dStarted = resolve; });

  await page.route('**/api/v1/inventory/statistics?*', async route => {
    const url = new URL(route.request().url());
    const period = url.searchParams.get('period');
    if (period === '30d') {
      mark30dStarted();
      await gate30d;
      try {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ statistics: statisticsFixture('30d') }) });
      } catch {
        // The current implementation actively aborts superseded requests.
      }
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ statistics: statisticsFixture(period) }) });
  });

  await page.goto('/#home');
  await page.getByRole('button', { name: /Inventario/i }).first().click();
  const inventory = page.locator('.view[data-view="inventory"]');
  await inventory.getByRole('button', { name: 'Estadísticas', exact: true }).first().click();
  await started30d;

  await page.locator('#statistics-period').selectOption('90d');
  await expect(page.locator('#statistics-categories-table')).toContainText('Lácteos 90d');
  await expect(page.locator('#statistics-stores-table')).toContainText('Centro 90d');
  await expect(page.locator('#statistics-kpis')).toContainText('8');
  await expect(page.locator('#statistics-kpis')).toContainText('84,00');

  release30d();
  await page.waitForTimeout(50);
  await expect(page.locator('#statistics-period')).toHaveValue('90d');
  await expect(page.locator('#statistics-categories-table')).toContainText('Lácteos 90d');
  await expect(page.locator('#statistics-categories-table')).not.toContainText('Lácteos 30d');
  await expect(page.locator('#statistics-model-note')).toContainText('No existe stock canónico');
  await expectNoHorizontalOverflow(page);
  await page.locator('.view[data-view="inventory-statistics"]').screenshot({ path: testInfo.outputPath('inventory-statistics-desktop.png') });
});
