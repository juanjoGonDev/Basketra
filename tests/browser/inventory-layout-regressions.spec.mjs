import { test, expect } from '@playwright/test';

async function navigateToInventory(page) {
  await page.goto('/#home');
  await page.getByRole('button', { name: /Inventario/i }).first().click();
}

async function installStatisticsRoute(page) {
  await page.route('**/api/v1/inventory/statistics?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      statistics: {
        summary: {
          latestCatalogValueMinor: 2500,
          activeProducts: 8,
          ticketsProcessed: 6,
          entriesValueMinor: 8400,
          lowStockUnavailableReason: 'No existe stock canónico; no se inventan existencias.',
        },
        categoryStats: [{ id: 'category_dairy', name: 'Lácteos 90d', productCount: 4, ticketCount: 4, spentMinor: 4200 }],
        storeStats: [{ id: 'store_central', retailerName: 'Mercado Central', name: 'Centro 90d', productCount: 6, ticketCount: 4, spentMinor: 6000 }],
        ticketTrend: [{ date: '2026-09-02', ticketCount: 2, spentMinor: 3000 }],
      },
    }),
  }));
}

async function installTicketHistoryRoutes(page) {
  await page.route('**/api/v1/categories', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ categories: [{ id: 'category_dairy', name: 'Lácteos', color: '#5D8BF4' }] }),
  }));
  await page.route('**/api/v1/inventory/stores?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ stores: [{ id: 'store_central', retailerName: 'Mercado Central', name: 'Centro' }], total: 1, offset: 0, limit: 100, hasMore: false }),
  }));
  await page.route('**/api/v1/inventory/tickets?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      tickets: [{
        id: 'ticket_20260902',
        retailerName: 'Mercado Central',
        storeId: 'store_central',
        storeName: 'Mercado Central · Centro',
        declaredTotalMinor: 150,
        purchasedAt: '2026-09-02T18:30:00.000Z',
        paymentStatus: 'paid',
        paymentMethod: 'Tarjeta',
        notes: 'Compra semanal',
        itemCount: 1,
      }],
      total: 1,
      offset: 0,
      limit: 12,
      hasMore: false,
      summary: { ticketCount: 1, totalSpentMinor: 150, itemCount: 1, averageTicketMinor: 150 },
    }),
  }));
}

test('statistics keep every desktop table column inside its visible surface', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installStatisticsRoute(page);
  await navigateToInventory(page);
  await page.getByRole('button', { name: 'Estadísticas', exact: true }).first().click();
  await expect(page.locator('#statistics-stores-table')).toContainText('Centro 90d');

  const geometry = await page.locator('#statistics-stores-table').evaluate(tbody => {
    const table = tbody.closest('table');
    const wrapper = table?.closest('.inventory-table-wrap');
    const lastHeader = table?.querySelector('thead th:last-child');
    if (!table || !wrapper || !lastHeader) return null;
    const wrapperRect = wrapper.getBoundingClientRect();
    const headerRect = lastHeader.getBoundingClientRect();
    return {
      wrapperRight: wrapperRect.right,
      headerRight: headerRect.right,
      scrollWidth: wrapper.scrollWidth,
      clientWidth: wrapper.clientWidth,
    };
  });

  expect(geometry).not.toBeNull();
  expect(geometry.headerRight).toBeLessThanOrEqual(geometry.wrapperRight + 1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
});

test('ticket history desktop date filters never overlap', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installTicketHistoryRoutes(page);
  await page.goto('/#home');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
  await page.getByRole('button', { name: 'Historial', exact: true }).click();
  await expect(page.locator('#ticket-history-date-from')).toBeVisible();

  const [from, to] = await Promise.all([
    page.locator('#ticket-history-date-from').boundingBox(),
    page.locator('#ticket-history-date-to').boundingBox(),
  ]);
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();

  const separatedHorizontally = from.x + from.width + 8 <= to.x || to.x + to.width + 8 <= from.x;
  const separatedVertically = from.y + from.height + 8 <= to.y || to.y + to.height + 8 <= from.y;
  expect(separatedHorizontally || separatedVertically).toBe(true);
});

test('inventory mobile filter control keeps a visible text affordance', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await navigateToInventory(page);
  const filters = page.getByRole('button', { name: 'Abrir filtros', exact: true });
  await expect(filters).toBeVisible();
  const box = await filters.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(92);
});
