import { test, expect } from '@playwright/test';

test('offline component gallery exposes shared controls and dialog behavior', async ({ page }) => {
  await page.route('**/api/v1/meta', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: false }) }));
  await page.goto('/components');

  await expect(page.locator('.view[data-view="components"]')).toBeVisible();
  await expect(page.locator('.view[data-view="components"] app-field')).toHaveCount(4);
  await expect(page.locator('app-button button[disabled]')).toBeDisabled();
  await expect(page.locator('app-field[data-state="error"] input')).toHaveAttribute('aria-invalid', 'true');
  const primaryButton = page.getByRole('button', { name: 'Principal' });
  await primaryButton.hover();
  await primaryButton.focus();
  await expect(primaryButton).toBeFocused();
  await page.getByRole('button', { name: 'Abrir diálogo' }).click();
  const dialog = page.locator('#components-demo-dialog').locator('dialog');
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar' }).last().click();
  await expect(dialog).toBeHidden();
});
