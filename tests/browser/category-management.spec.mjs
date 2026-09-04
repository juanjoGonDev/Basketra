import { test, expect } from '@playwright/test';

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

async function setCategoryColor(locator, value) {
  await locator.evaluate((input, nextValue) => {
    input.value = nextValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('hierarchical categories use separate list, detail and editor flows on mobile and desktop', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });

  const categories = [
    { id: 'category_unknown', name: 'desconocido', color: '#64748B', createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' },
    { id: 'category_food', name: 'Alimentación', color: '#118844', description: 'Productos alimentarios', createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' },
  ];
  let createPayload;
  let updatePayload;

  await page.route('**/api/v1/catalog?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ catalog: { products: [], parents: [], total: 0, offset: 0, limit: 100, hasMore: false } }) }));
  await page.route('**/api/v1/categories**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') {
      createPayload = request.postDataJSON();
      const created = {
        id: 'category_dairy',
        name: createPayload.name,
        ...(createPayload.parentId ? { parentId: createPayload.parentId } : {}),
        color: createPayload.color,
        ...(createPayload.description ? { description: createPayload.description } : {}),
        createdAt: '2026-09-02T00:01:00.000Z',
        updatedAt: '2026-09-02T00:01:00.000Z',
      };
      categories.push(created);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ category: created }) });
      return;
    }
    if (url.searchParams.get('mode') === 'inventory') {
      const inventoryCategories = categories.map(category => ({
        ...category,
        parentName: category.parentId ? categories.find(candidate => candidate.id === category.parentId)?.name : undefined,
        productCount: 0,
        childCount: categories.filter(candidate => candidate.parentId === category.id).length,
      }));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ inventory: { categories: inventoryCategories, total: inventoryCategories.length, offset: 0, limit: 12, hasMore: false } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ categories }) });
  });

  await page.route('**/api/v1/categories/category_dairy', async route => {
    updatePayload = route.request().postDataJSON();
    const category = categories.find(entry => entry.id === 'category_dairy');
    Object.assign(category, updatePayload, {
      parentId: updatePayload.parentId || undefined,
      description: updatePayload.description || undefined,
      updatedAt: '2026-09-02T00:02:00.000Z',
    });
    if (!category.parentId) delete category.parentId;
    if (!category.description) delete category.description;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ category }) });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Inventario/i }).first().click();
  await page.locator('.view[data-view="inventory"]').getByRole('button', { name: 'Categorías', exact: true }).first().click();

  await expect(page).toHaveURL(/\/inventory\/categories$/);
  await expect(page.getByRole('heading', { name: 'Categorías', exact: true })).toBeVisible();
  await expect(page.locator('#category-range')).toHaveText('1-2 de 2');

  const foodRow = page.locator('[data-category-id="category_food"]');
  await foodRow.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/inventory\/categories\/category_food$/);
  await expect(page.locator('#category-form-title')).toHaveText('Alimentación');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir subcategoría' }).click();
  await expect(page).toHaveURL(/\/inventory\/categories\/new$/);
  await expect(page.locator('#category-parent')).toHaveValue('category_food');

  await page.locator('#category-name').fill('Lácteos');
  await setCategoryColor(page.locator('#category-color'), '#33aaff');
  await page.locator('#category-description').fill('Leche, yogur y derivados');
  await page.getByRole('button', { name: 'Guardar categoría' }).click();

  await expect.poll(() => createPayload).toEqual({ name: 'Lácteos', parentId: 'category_food', color: '#33AAFF', description: 'Leche, yogur y derivados' });
  await expect(page).toHaveURL(/\/inventory\/categories\/category_dairy$/);
  await expect(page.locator('#category-detail-name')).toHaveText('Lácteos');

  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.locator('#category-name').fill('Lácteos y huevos');
  await page.locator('#category-parent').selectOption('');
  await setCategoryColor(page.locator('#category-color'), '#445566');
  await page.getByRole('button', { name: 'Guardar categoría' }).click();

  await expect.poll(() => updatePayload).toEqual({ name: 'Lácteos y huevos', parentId: null, color: '#445566', description: 'Leche, yogur y derivados' });
  await page.getByRole('button', { name: 'Categorías', exact: true }).click();
  const movedRow = page.locator('[data-category-id="category_dairy"]');
  await expect(movedRow).toBeVisible();
  await expect(movedRow.locator('.category-indent-step')).toHaveCount(0);

  const unknownRow = page.locator('[data-category-id="category_unknown"]');
  await unknownRow.click();
  await expect(page.locator('#category-protected-note')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Eliminar', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.locator('#category-name')).toBeDisabled();
  await expect(page.locator('#category-parent')).toBeDisabled();

  await expectNoHorizontalOverflow(page);
  const categoryView = page.locator('.view[data-view="categories"]');
  const shell = page.locator('.app-header, .bottom-nav, .skip-link');
  const shellHiddenState = await shell.evaluateAll(elements => elements.map(element => element.hidden));
  await shell.evaluateAll(elements => elements.forEach(element => { element.hidden = true; }));
  try {
    await categoryView.screenshot({ path: testInfo.outputPath('categories-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectNoHorizontalOverflow(page);
    await categoryView.screenshot({ path: testInfo.outputPath('categories-desktop.png') });
  } finally {
    await shell.evaluateAll((elements, hiddenState) => { elements.forEach((element, index) => { element.hidden = hiddenState[index]; }); }, shellHiddenState);
  }

  expect(browserErrors).toEqual([]);
});
