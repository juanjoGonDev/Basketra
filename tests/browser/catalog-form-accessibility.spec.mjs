import { test, expect } from '@playwright/test';

const emptyCatalog = { products: [], parents: [], total: 0, offset: 0, limit: 12, hasMore: false };

async function openNewProduct(page) {
  await page.route('**/api/v1/catalog?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ catalog: emptyCatalog }),
  }));
  await page.goto('/#inventory');
  await page.getByRole('button', { name: 'Productos', exact: true }).first().click();
  await page.getByRole('button', { name: 'Nuevo producto', exact: true }).click();
  await expect(page.locator('#catalog-editor')).toBeVisible();
}

test('catalog form declares required fields, keeps optional values out of create payloads and maps validation errors to fields', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let submittedPayload;
  await page.route('**/api/v1/products', route => {
    submittedPayload = route.request().postDataJSON();
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Brand is invalid', details: { path: '$.brand' } } }),
    });
  });

  await openNewProduct(page);
  const form = page.locator('#catalog-product-form');
  await expect(form.getByText('Obligatorio', { exact: true })).toHaveCount(2);
  await expect(form.getByText('Opcional', { exact: true })).toHaveCount(7);
  await form.getByRole('button', { name: 'Guardar ficha', exact: true }).click();
  await expect(page.locator('#catalog-canonical-name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#catalog-variant-name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#catalog-product-form-state')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#catalog-canonical-name')).toBeFocused();

  await page.locator('#catalog-canonical-name').fill('Leche');
  await page.locator('#catalog-variant-name').fill('Leche entera');
  await form.getByRole('button', { name: 'Guardar ficha', exact: true }).click();
  await expect.poll(() => submittedPayload).toEqual({ canonicalName: 'Leche', variantName: 'Leche entera', aliases: [] });
  await expect(page.locator('#catalog-product-form-state')).toContainText('Revisa el campo');
  await expect(page.locator('#catalog-brand')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#catalog-brand-error')).toHaveText('Brand is invalid');
  await expect(page.locator('#catalog-brand')).toBeFocused();
});

test('catalog details expose a navigable breadcrumb and the application shell has no visual footer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openNewProduct(page);
  const breadcrumb = page.getByRole('navigation', { name: 'Ruta de navegación' });
  await expect(breadcrumb).toBeVisible();
  await expect(breadcrumb.getByRole('link', { name: 'Inventario', exact: true })).toHaveAttribute('href', '#inventory');
  await expect(breadcrumb.getByRole('link', { name: 'Productos', exact: true })).toHaveAttribute('href', '#catalog');
  await expect(breadcrumb.locator('.icon')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Limpiar filtros', exact: true }).locator('.icon')).toHaveCount(1);
  await breadcrumb.getByRole('link', { name: 'Inventario', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#inventory$/);
  const pseudoFooter = await page.evaluate(() => getComputedStyle(document.body, '::after').content);
  expect(pseudoFooter).toBe('none');
});
