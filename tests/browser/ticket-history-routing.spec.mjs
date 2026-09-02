import { test, expect } from '@playwright/test';

async function installHistoryRoutes(page) {
  await page.route('**/api/v1/categories', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ categories: [] }),
  }));
  await page.route('**/api/v1/inventory/stores?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ stores: [], total: 0, offset: 0, limit: 100, hasMore: false }),
  }));
  await page.route('**/api/v1/inventory/tickets?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      tickets: [],
      total: 0,
      offset: 0,
      limit: 12,
      hasMore: false,
      summary: { ticketCount: 0, totalSpentMinor: 0, itemCount: 0, averageTicketMinor: 0 },
    }),
  }));
}

test('ticket history supports direct deep links and browser back to capture', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installHistoryRoutes(page);

  await page.goto('/#ticket-history');
  await expect(page).toHaveURL(/#ticket-history$/);
  await expect(page.getByRole('heading', { name: 'Historial de tickets' })).toBeVisible();
  await expect(page.locator('.bottom-nav [data-nav="scan"]')).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Captura', exact: true }).first().click();
  await expect(page).toHaveURL(/#scan$/);
  await expect(page.getByRole('heading', { name: 'Captura y revisa' })).toBeVisible();

  await page.getByRole('button', { name: 'Historial', exact: true }).click();
  await expect(page).toHaveURL(/#ticket-history$/);
  await page.goBack();
  await expect(page).toHaveURL(/#scan$/);
  await expect(page.getByRole('heading', { name: 'Captura y revisa' })).toBeVisible();
});
