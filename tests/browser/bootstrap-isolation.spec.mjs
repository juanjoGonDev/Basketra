import { test, expect } from '@playwright/test';

test('Tickets initializes even when shopping-list bootstrap fails', async ({ page }) => {
  await page.route('**/api/v1/shopping-lists', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'LISTS_UNAVAILABLE', message: 'Lists unavailable' } }),
  }));
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  await page.goto('/#home');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();

  await expect(page).toHaveURL(/#scan$/);
  await expect(page.locator('#receipt-analysis-options')).toBeVisible();
  await expect(page.locator('#receipt-progress')).toBeAttached();
  await expect(page.locator('#receipt-review-panel')).toBeAttached();
});
