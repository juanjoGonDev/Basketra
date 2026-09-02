import { test, expect } from '@playwright/test';

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

async function setCategoryColor(locator, value) {
  await locator.evaluate((input, nextValue) => {
    input.value = nextValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('hierarchical categories can be created, reparented and reviewed on mobile and desktop', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  const categories = [
    {
      id: 'category_unknown',
      name: 'desconocido',
      color: '#64748B',
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    },
    {
      id: 'category_food',
      name: 'Alimentación',
      color: '#118844',
      description: 'Productos alimentarios',
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    },
  ];
  let createPayload;
  let updatePayload;

  await page.route('**/api/v1/categories', async route => {
    if (route.request().method() === 'POST') {
      createPayload = route.request().postDataJSON();
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

  await page.goto('/#home');
  const categoriesEntry = page.getByRole('button', { name: /Categorías/i });
  await expect(categoriesEntry).toBeVisible();
  await categoriesEntry.click();

  await expect(page).toHaveURL(/#categories$/);
  await expect(page.getByRole('heading', { name: 'Categorías', exact: true })).toBeVisible();
  await expect(page.locator('#category-count')).toHaveText('2');

  const foodRow = page.getByRole('button', { name: /Alimentación/ });
  await foodRow.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#category-form-title')).toHaveText('Alimentación');
  await page.getByRole('button', { name: 'Añadir subcategoría' }).click();
  await expect(page.locator('#category-parent')).toHaveValue('category_food');

  await page.locator('#category-name').fill('Lácteos');
  await setCategoryColor(page.locator('#category-color'), '#33aaff');
  await page.locator('#category-description').fill('Leche, yogur y derivados');
  await page.getByRole('button', { name: 'Guardar categoría' }).click();

  await expect.poll(() => createPayload).toEqual({
    name: 'Lácteos',
    parentId: 'category_food',
    color: '#33AAFF',
    description: 'Leche, yogur y derivados',
  });
  await expect(page.locator('#category-count')).toHaveText('3');
  const dairyRow = page.getByRole('button', { name: /Lácteos/ });
  await expect(dairyRow).toBeVisible();
  await expect.poll(() => dairyRow.evaluate(element => element.style.getPropertyValue('--category-depth'))).toBe('1');

  await dairyRow.click();
  await page.locator('#category-name').fill('Lácteos y huevos');
  await page.locator('#category-parent').selectOption('');
  await setCategoryColor(page.locator('#category-color'), '#445566');
  await page.getByRole('button', { name: 'Guardar categoría' }).click();

  await expect.poll(() => updatePayload).toEqual({
    name: 'Lácteos y huevos',
    parentId: null,
    color: '#445566',
    description: 'Leche, yogur y derivados',
  });
  const movedRow = page.getByRole('button', { name: /Lácteos y huevos/ });
  await expect.poll(() => movedRow.evaluate(element => element.style.getPropertyValue('--category-depth'))).toBe('0');

  const unknownRow = page.getByRole('button', { name: /desconocido/ });
  await unknownRow.click();
  await expect(page.locator('#category-name')).toBeDisabled();
  await expect(page.locator('#category-parent')).toBeDisabled();
  await expect(page.locator('#category-protected-note')).toBeVisible();

  await expectNoHorizontalOverflow(page);
  const categoryView = page.locator('.view[data-view="categories"]');
  const shell = page.locator('.app-header, .bottom-nav, .skip-link');
  const shellHiddenState = await shell.evaluateAll(elements => elements.map(element => element.hidden));
  await shell.evaluateAll(elements => elements.forEach(element => { element.hidden = true; }));
  try {
    await categoryView.screenshot({ path: testInfo.outputPath('categories-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectNoHorizontalOverflow(page);
    const browserBox = await page.locator('.category-browser').boundingBox();
    const detailBox = await page.locator('.category-detail').boundingBox();
    expect(browserBox).not.toBeNull();
    expect(detailBox).not.toBeNull();
    expect(detailBox.x).toBeGreaterThan(browserBox.x + browserBox.width / 2);
    await categoryView.screenshot({ path: testInfo.outputPath('categories-desktop.png') });
  } finally {
    await shell.evaluateAll((elements, hiddenState) => {
      elements.forEach((element, index) => { element.hidden = hiddenState[index]; });
    }, shellHiddenState);
  }

  expect(browserErrors).toEqual([]);
});
