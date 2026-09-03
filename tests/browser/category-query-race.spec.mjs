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
  const newCategoryRow = page.locator('[data-category-id="category_new"]');
  const oldCategoryRow = page.locator('[data-category-id="category_old"]');
  await expect(newCategoryRow).toBeVisible();
  await expect(oldCategoryRow).toHaveCount(0);

  releaseFirstRequest();
  await firstRequestFinished;
  await expect(newCategoryRow).toBeVisible();
  await expect(oldCategoryRow).toHaveCount(0);
  await expect(page.locator('#category-state')).toHaveText('1 categorías encontradas.');
});

test('category save completion does not reopen detail after the user returns to the list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let releaseSave;
  let markSaveStarted;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  const saveStarted = new Promise(resolve => { markSaveStarted = resolve; });
  const category = {
    id: 'category_dairy',
    name: 'Lácteos',
    color: '#33AAFF',
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
  };

  await page.route('**/api/v1/categories**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/category_dairy/delete-impact')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ impact: { productCount: 0, childCount: 0, descendantCategoryCount: 0, descendantProductCount: 0, protected: false, canDelete: true } }),
      });
      return;
    }
    if (request.method() === 'PATCH' && url.pathname.endsWith('/category_dairy')) {
      markSaveStarted();
      await saveGate;
      Object.assign(category, request.postDataJSON(), { updatedAt: '2026-09-03T00:01:00.000Z' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ category }) });
      return;
    }
    if (url.searchParams.get('mode') === 'inventory') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ inventory: { categories: [{ ...category, productCount: 0, childCount: 0 }], total: 1, offset: 0, limit: 12, hasMore: false } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ categories: [category] }) });
  });

  await page.goto('/#categories:category_dairy');
  await expect(page.locator('#category-detail-name')).toHaveText('Lácteos');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.locator('#category-name').fill('Lácteos y huevos');
  await page.getByRole('button', { name: 'Guardar categoría', exact: true }).click();
  await saveStarted;

  await page.getByRole('button', { name: 'Categorías', exact: true }).click();
  await expect(page).toHaveURL(/#categories$/u);
  await expect(page.locator('#category-list-screen')).toBeVisible();

  releaseSave();
  await expect(page.locator('#category-save')).toBeEnabled();
  await expect(page).toHaveURL(/#categories$/u);
  await expect(page.locator('#category-list-screen')).toBeVisible();
  await expect(page.locator('#category-detail')).toBeHidden();
});
