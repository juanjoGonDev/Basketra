import { test, expect } from '@playwright/test';

test('category search ignores a stale response that finishes after the latest query', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let releaseFirstRequest;
  let markFirstRequestStarted;
  let markFirstRequestFinished;
  const firstRequestGate = new Promise(resolve => { releaseFirstRequest = resolve; });
  const firstRequestStarted = new Promise(resolve => { markFirstRequestStarted = resolve; });
  const firstRequestFinished = new Promise(resolve => { markFirstRequestFinished = resolve; });
  const inventoryQueries = [];

  const metadataCategories = [
    { id: 'category_old', name: 'Antigua', color: '#64748B' },
    { id: 'category_new', name: 'Nueva', color: '#118844' },
  ];

  await page.route('**/api/v1/categories**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('mode') !== 'inventory') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ categories: metadataCategories }) });
      return;
    }

    const query = url.searchParams.get('q') || '';
    inventoryQueries.push(query);
    if (inventoryQueries.length === 1) {
      markFirstRequestStarted();
      await firstRequestGate;
      try {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ inventory: { categories: [{ id: 'category_old', name: 'Antigua', color: '#64748B', productCount: 0, childCount: 0 }], total: 1, offset: 0, limit: 12, hasMore: false } }),
        });
      } catch {
        // The latest search is expected to abort this older transport.
      } finally {
        markFirstRequestFinished();
      }
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ inventory: { categories: [{ id: 'category_new', name: 'Nueva', color: '#118844', productCount: 0, childCount: 0 }], total: 1, offset: 0, limit: 12, hasMore: false } }),
    });
  });

  await page.goto('/#categories');
  await firstRequestStarted;
  await page.locator('#category-search').fill('nueva');
  await expect.poll(() => inventoryQueries).toContain('nueva');
  await expect(page.getByRole('button', { name: /Nueva/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Antigua/ })).toHaveCount(0);

  releaseFirstRequest();
  await firstRequestFinished;
  await expect(page.getByRole('button', { name: /Nueva/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Antigua/ })).toHaveCount(0);
  await expect(page.locator('#category-state')).toHaveText('1 categorías encontradas.');
});
