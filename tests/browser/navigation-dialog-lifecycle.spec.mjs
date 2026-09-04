import { test, expect } from '@playwright/test';

test('navigating away closes the active shopping-item editor immediately', async ({ page }) => {
  await page.goto('/lists');
  await page.getByRole('button', { name: 'Nueva lista', exact: true }).click();
  const createDialog = page.locator('#create-list-dialog');
  await createDialog.getByLabel('Nombre', { exact: true }).fill('Compra');
  await createDialog.getByRole('button', { name: 'Crear lista', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir producto', exact: true }).click();
  const itemDialog = page.locator('#item-dialog');
  await expect(itemDialog).toHaveAttribute('open', '');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('basketra:navigate', {
    detail: { route: 'inventory' },
  })));
  await expect(itemDialog).not.toHaveAttribute('open', '');
  await expect(page).toHaveURL(/\/inventory$/);
});
