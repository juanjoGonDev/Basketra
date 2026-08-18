import { test, expect } from '@playwright/test';

const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==', 'base64');

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

async function selectedTab(page, group) {
  return page.locator(`[data-tab-group="${group}"] [role="tab"][aria-selected="true"]`);
}

test('tickets expose one task stage at a time with keyboard-operable tabs', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await navigate(page, 'Tickets');

  const tabs = page.locator('[data-tab-group="tickets"]');
  await expect(tabs).toBeVisible();
  await expect(selectedTab(page, 'tickets')).toHaveText('Capturas');
  await expect(page.locator('[data-tab-panel="captures"]')).toBeVisible();
  await expect(page.locator('[data-tab-panel="progress"]')).toBeHidden();
  await expect(page.locator('[data-tab-panel="review"]')).toBeHidden();
  await expect(page.locator('[data-tab-panel="import"]')).toBeHidden();

  const capturesTab = tabs.getByRole('tab', { name: 'Capturas', exact: true });
  await capturesTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(selectedTab(page, 'tickets')).toHaveText('Progreso');
  await expect(tabs.getByRole('tab', { name: 'Progreso', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(selectedTab(page, 'tickets')).toHaveText('Importar');
  await page.keyboard.press('Home');
  await expect(selectedTab(page, 'tickets')).toHaveText('Capturas');

  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('tickets-progressive-captures.png'), fullPage: false });
});

test('receipt lines stay compact and edit in an accessible contextual sheet', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-camera').setInputFiles({
    name: 'progressive.png',
    mimeType: 'image/png',
    buffer: validPng,
  });

  await page.getByRole('tab', { name: 'Progreso', exact: true }).click();
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('.receipt-line-compact')).toHaveCount(1);
  await expect(selectedTab(page, 'tickets')).toHaveText('Revisión');

  const line = page.locator('.receipt-item').first();
  await expect(line.locator('[data-field="description"]')).toBeHidden();
  const summary = page.locator('.receipt-line-compact').first();
  await expect(summary).toBeVisible();
  await summary.click();

  const dialog = page.locator('#receipt-line-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Editar línea 1' })).toBeVisible();
  const description = dialog.locator('[data-field="description"]');
  await expect(description).toBeFocused();
  await description.fill('Leche revisada');
  await dialog.getByRole('button', { name: 'Guardar línea', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(summary).toContainText('Leche revisada');
  await expect(summary).toBeFocused();

  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('receipt-review-compact.png'), fullPage: false });
});

test('settings separate operational areas and keep technical detail on demand', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await navigate(page, 'Ajustes');

  const settings = page.locator('[data-tab-group="settings"]');
  await expect(settings).toBeVisible();
  await expect(selectedTab(page, 'settings')).toHaveText('General');
  await expect(page.getByRole('heading', { name: 'Servidor y versión' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Diagnóstico de IA' })).toBeHidden();

  await settings.getByRole('tab', { name: 'IA', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Diagnóstico de IA' })).toBeVisible();
  const technical = page.locator('.technical-disclosure');
  await expect(technical).not.toHaveAttribute('open', '');
  await technical.getByText('Detalles técnicos de la conexión', { exact: true }).click();
  await expect(technical).toHaveAttribute('open', '');
  await expect(page.locator('#ai-provider-request')).toBeVisible();

  await settings.getByRole('tab', { name: 'Datos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Copias de seguridad' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Servidor y versión' })).toBeHidden();

  await settings.getByRole('tab', { name: 'Avanzado', exact: true }).click();
  const advanced = page.locator('.settings-advanced-disclosure');
  await expect(advanced).toBeVisible();
  await expect(advanced).not.toHaveAttribute('open', '');
  await advanced.getByText('Diagnóstico técnico', { exact: true }).click();
  await expect(advanced).toHaveAttribute('open', '');
  await expect(page.locator('#diagnostics')).toBeVisible();

  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('settings-progressive-advanced.png'), fullPage: false });
});

test('plans present recommendation, comparison and details without exposing all cards at once', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await navigate(page, 'Planes');
  await page.getByRole('button', { name: 'Generar ejemplo verificable', exact: true }).click();

  await expect(selectedTab(page, 'plans')).toHaveText('Mejor opción');
  await expect(page.locator('[data-tab-panel="best"] .plan-card')).toHaveCount(1);
  await expect(page.locator('[data-tab-panel="compare"]')).toBeHidden();

  await page.getByRole('tab', { name: 'Comparativa', exact: true }).click();
  await expect(page.locator('.plan-comparison-row')).toHaveCount(3);
  await expect(page.locator('[data-tab-panel="best"]')).toBeHidden();

  await page.getByRole('tab', { name: 'Detalle', exact: true }).click();
  await expect(page.locator('.plan-detail-disclosure')).toHaveCount(3);
  await expect(page.locator('.plan-detail-disclosure[open]')).toHaveCount(1);

  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('plans-progressive-detail.png'), fullPage: false });
});
