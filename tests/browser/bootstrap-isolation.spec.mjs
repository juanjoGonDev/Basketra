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

  await page.goto('/');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();

  await expect(page).toHaveURL(/\/tickets$/);
  await expect(page.locator('#receipt-analysis-options')).toBeVisible();
  await expect(page.locator('#receipt-progress')).toBeAttached();
  await expect(page.locator('#receipt-review-panel')).toBeAttached();
});

test('primary navigation stays disabled until application bootstrap is ready', async ({ page }) => {
  let releaseMetadata = () => {};
  const metadataGate = new Promise(resolve => {
    releaseMetadata = resolve;
  });

  await page.route('**/api/v1/meta', async route => {
    await metadataGate;
    await route.continue();
  });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  await page.goto('/');
  const tickets = page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true });
  await expect(page.locator('#main')).toHaveAttribute('aria-busy', 'true');
  await expect(tickets).toBeDisabled();

  releaseMetadata();

  await expect(page.locator('#main')).toHaveAttribute('aria-busy', 'false');
  await expect(tickets).toBeEnabled();
  await tickets.click();
  await expect(page).toHaveURL(/\/tickets$/);
});
