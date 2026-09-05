import { test, expect } from '@playwright/test';

const ticket = {
  id: 'ticket_direct',
  retailerName: 'Mercado Central',
  declaredTotalMinor: 250,
  purchasedAt: '2026-09-02T18:30:00.000Z',
  createdAt: '2026-09-02T18:31:00.000Z',
  updatedAt: '2026-09-02T18:31:00.000Z',
  paymentStatus: 'paid',
  taxMinor: 0,
  receiptDiscountMinor: 0,
  itemCount: 1,
  items: [{
    id: 'receipt_item_direct',
    originalDescription: 'PAN',
    description: 'Pan',
    quantity: 1,
    unit: 'unit',
    unitPriceMinor: 250,
    lineTotalMinor: 250,
    status: 'confirmed',
    confidence: 1,
  }],
};

async function installHistoryRoutes(page) {
  await page.route('**/api/v1/categories', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ categories: [{ id: 'category_direct', name: 'Lácteos' }] }),
  }));
  await page.route('**/api/v1/inventory/stores?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ stores: [{ id: 'store_direct', name: 'Centro', retailerName: 'Mercado' }], total: 1, offset: 0, limit: 100, hasMore: false }),
  }));
  await page.route('**/api/v1/inventory/tickets?*', route => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') || 0);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tickets: [],
        total: 24,
        offset,
        limit: 12,
        hasMore: offset < 12,
        summary: { ticketCount: 24, totalSpentMinor: 0, itemCount: 0, averageTicketMinor: 0 },
      }),
    });
  });
  await page.route('**/api/v1/inventory/tickets/ticket_direct', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ticket }),
  }));
}

test('ticket history supports direct deep links and browser back to capture', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installHistoryRoutes(page);

  await page.goto('/tickets/history');
  await expect(page).toHaveURL(/\/tickets\/history$/);
  await expect(page.getByRole('heading', { name: 'Historial de tickets' })).toBeVisible();
  await expect(page.locator('.bottom-nav [data-nav="scan"]')).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Captura', exact: true }).first().click();
  await expect(page).toHaveURL(/\/tickets$/);
  await expect(page.getByRole('heading', { name: 'Captura y revisa' })).toBeVisible();

  await page.getByRole('button', { name: 'Historial', exact: true }).click();
  await expect(page).toHaveURL(/\/tickets\/history$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/tickets$/);
  await expect(page.getByRole('heading', { name: 'Captura y revisa' })).toBeVisible();
});

test('ticket detail deep link preserves the entity route through app bootstrap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installHistoryRoutes(page);

  await page.goto('/tickets/history/ticket_direct');
  await expect(page).toHaveURL(/\/tickets\/history\/ticket_direct$/);
  await expect(page.locator('#ticket-history-detail-screen')).toBeVisible();
  await expect(page.locator('#ticket-editor-title')).toContainText('ticket_direct');
  await expect(page.locator('#ticket-editor-total')).toContainText('2,50');
  await expect(page.locator('.bottom-nav [data-nav="scan"]')).toHaveAttribute('aria-current', 'page');

  await page.reload();
  await expect(page).toHaveURL(/\/tickets\/history\/ticket_direct$/);
  await expect(page.locator('#ticket-history-detail-screen')).toBeVisible();
  await expect(page.locator('#ticket-editor-title')).toContainText('ticket_direct');
});

test('ticket history restores filters and pagination from the clean URL across reload and back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installHistoryRoutes(page);

  await page.goto('/tickets/history?q=leche&from=2026-09-01&to=2026-09-03&store=store_direct&category=category_direct&status=paid&page=2');
  await expect(page.locator('#ticket-history-search')).toHaveValue('leche');
  await expect(page.locator('#ticket-history-date-from')).toHaveValue('2026-09-01');
  await expect(page.locator('#ticket-history-date-to')).toHaveValue('2026-09-03');
  await expect(page.locator('#ticket-history-store')).toHaveValue('store_direct');
  await expect(page.locator('#ticket-history-category')).toHaveValue('category_direct');
  await expect(page.locator('#ticket-history-status')).toHaveValue('paid');
  await expect(page.locator('#ticket-history-page')).toHaveText('2 / 2');

  await page.reload();
  await expect(page.locator('#ticket-history-search')).toHaveValue('leche');
  await expect(page.locator('#ticket-history-store')).toHaveValue('store_direct');
  await expect(page.locator('#ticket-history-category')).toHaveValue('category_direct');
  await expect(page.locator('#ticket-history-status')).toHaveValue('paid');
  await expect(page.locator('#ticket-history-page')).toHaveText('2 / 2');

  await page.locator('#ticket-history-status').selectOption('pending');
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('pending');
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe(null);
  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('paid');
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
  await expect(page.locator('#ticket-history-status')).toHaveValue('paid');
  await expect(page.locator('#ticket-history-page')).toHaveText('2 / 2');
});
