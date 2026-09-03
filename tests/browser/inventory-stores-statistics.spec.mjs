import { test, expect } from '@playwright/test';

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

async function installStoreRoutes(page) {
  let patchPayload;
  await page.route('**/api/v1/stores?*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/v1/stores') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        stores: [{
          id: 'store_central',
          retailerId: 'retailer_central',
          retailerName: 'Mercado Central',
          name: 'Centro',
          region: 'Sevilla',
          address: 'Calle Feria 1',
          latitudeMicrodegrees: 37392500,
          longitudeMicrodegrees: -5992500,
          osmType: 'node',
          osmId: '12345',
          productCount: 4,
          receiptCount: 2,
          lastActivityAt: '2026-09-02T11:00:00.000Z',
          createdAt: '2026-09-01T11:00:00.000Z',
          updatedAt: '2026-09-02T11:00:00.000Z',
        }],
        total: 1,
        offset: 0,
        limit: 12,
        hasMore: false,
      }),
    });
  });
  await page.route('**/api/v1/stores/store_central', async route => {
    if (route.request().method() === 'PATCH') {
      patchPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          store: {
            id: 'store_central',
            retailerId: 'retailer_central',
            retailerName: patchPayload.retailerName,
            name: patchPayload.name,
            region: patchPayload.region,
            address: patchPayload.address,
            latitudeMicrodegrees: patchPayload.latitudeMicrodegrees,
            longitudeMicrodegrees: patchPayload.longitudeMicrodegrees,
            osmType: patchPayload.osmType,
            osmId: patchPayload.osmId,
            productCount: 4,
            receiptCount: 2,
            priceObservationCount: 6,
            lastActivityAt: '2026-09-02T11:00:00.000Z',
            createdAt: '2026-09-01T11:00:00.000Z',
            updatedAt: '2026-09-02T12:00:00.000Z',
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        store: {
          id: 'store_central',
          retailerId: 'retailer_central',
          retailerName: 'Mercado Central',
          name: 'Centro',
          region: 'Sevilla',
          address: 'Calle Feria 1',
          latitudeMicrodegrees: 37392500,
          longitudeMicrodegrees: -5992500,
          osmType: 'node',
          osmId: '12345',
          productCount: 4,
          receiptCount: 2,
          priceObservationCount: 6,
          lastActivityAt: '2026-09-02T11:00:00.000Z',
          createdAt: '2026-09-01T11:00:00.000Z',
          updatedAt: '2026-09-02T11:00:00.000Z',
        },
      }),
    });
  });
  await page.route('**/api/v1/stores/store_central/delete-impact', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        impact: {
          productCount: 4,
          priceObservationCount: 6,
          receiptCount: 2,
          canDelete: false,
        },
      }),
    });
  });
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ statistics: { period: '30d', productCount: 3, categoryCount: 1, storeCount: 1, ticketCount: 1, totalSpentMinor: 100, averageTicketMinor: 100, catalogValueMinor: 200, categoryStats: [], storeStats: [], ticketTrend: [] } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ statistics: { period: '90d', productCount: 9, categoryCount: 2, storeCount: 2, ticketCount: 4, totalSpentMinor: 12000, averageTicketMinor: 3000, catalogValueMinor: 5000, categoryStats: [{ id: 'category_dairy', name: 'Lácteos', productCount: 4, spentMinor: 4000 }], storeStats: [{ id: 'store_central', name: 'Centro', retailerName: 'Mercado Central', ticketCount: 3, totalSpentMinor: 9000 }], ticketTrend: [{ bucket: '2026-09-01', ticketCount: 2, totalSpentMinor: 6000 }] } }) });
  });

  await page.goto('/#inventory-statistics');
  await started30d;
  await page.locator('#statistics-period').selectOption('90d');
  release30d();

  await expect(page.locator('#statistics-products')).toHaveText('9');
  await expect(page.locator('#statistics-tickets')).toHaveText('4');
  await expect(page.locator('#statistics-spent')).toContainText('120,00');
  await expect(page.locator('#statistics-category-table')).toContainText('Lácteos');
  await expect(page.locator('#statistics-store-table')).toContainText('Mercado Central');
  await expect(page.locator('#statistics-trend-table')).toContainText('01/09/2026');
  await page.locator('.view[data-view="inventory-statistics"]').screenshot({ path: testInfo.outputPath('statistics-desktop.png') });
});
