import { test, expect } from '@playwright/test';

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

async function setup(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));
  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.evaluate(async () => {
    const { applyExtraction } = await import('/receipt-review.js');
    const item = {
      description: 'BEBIDA COCO 0% A',
      quantity: 2,
      unitPriceMinor: 175,
      lineTotalMinor: 262,
      discount: { type: 'percentage', basisPoints: 5_000, quantity: 1 },
      confidence: 0.99,
      sourceLines: [1, 2, 3],
    };
    applyExtraction({
      originalText: 'BEBIDA COCO 0% A 1,75\nBEBIDA COCO 0% A 1,75\n50% dto BEBIDA COCO 0% A 0,88-',
      final: {
        items: [item],
        declaredTotalMinor: 262,
        warnings: [],
        review: {
          lines: [{ ...item, status: 'confirmed', expectedMinor: 262, differenceMinor: 0 }],
          total: { expectedMinor: 262, differenceMinor: 0, valid: true },
        },
      },
    });
  });
}

async function openEditor(page) {
  await page.locator('.receipt-line-compact').click();
  const dialog = page.locator('#receipt-line-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function expectNoHorizontalOverflow(page, dialog) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect.poll(() => dialog.locator('.receipt-line-editor-layout').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
}

test('receipt editor uses invoice hierarchy on desktop', async ({ page }, testInfo) => {
  await setup(page, 1280, 900);
  const dialog = await openEditor(page);

  await expect(dialog.getByRole('heading', { name: '1. Producto', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '2. Detalle de compra', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '3. Descuento', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Resumen', exact: true })).toBeVisible();
  await expect(dialog.locator('[data-editor-validation]')).toHaveText('Validada');

  await expect(dialog.locator('[data-editor-summary-base]')).toHaveText('3,50 €');
  await expect(dialog.locator('[data-editor-summary-discount]')).toHaveText('-0,88 €');
  await expect(dialog.locator('[data-field="lineTotalEuro"]')).toHaveJSProperty('value', '2.62');
  await expect(dialog.locator('[data-editor-summary-total]')).toHaveText('2,62 €');

  const layout = dialog.locator('.receipt-line-editor-layout');
  await expect(layout).toHaveCSS('display', 'grid');
  await expect.poll(async () => (await layout.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)) >= 2).toBe(true);
  await expectNoHorizontalOverflow(page, dialog);

  await dialog.screenshot({ path: testInfo.outputPath('invoice-editor-desktop.png') });
});

test('receipt editor reflows as an invoice sheet across mobile widths', async ({ page }, testInfo) => {
  await setup(page, 360, 800);
  const dialog = await openEditor(page);

  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, dialog);
    await expect(dialog.locator('[data-editor-summary-total]')).toHaveText('2,62 €');
  }

  const layout = dialog.locator('.receipt-line-editor-layout');
  await expect.poll(async () => (await layout.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)) === 1).toBe(true);
  await expect(dialog.getByLabel('Unidades con descuento')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Guardar línea', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Eliminar', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({ path: testInfo.outputPath('invoice-editor-mobile.png') });
});

test('invoice summary follows the backend-derived total', async ({ page }) => {
  await setup(page, 1280, 900);
  const dialog = await openEditor(page);
  const affectedUnits = dialog.getByLabel('Unidades con descuento');

  await affectedUnits.fill('2');
  await expect(dialog.locator('[data-field="lineTotalEuro"]')).toHaveJSProperty('value', '1.75');
  await expect(dialog.locator('[data-editor-summary-base]')).toHaveText('3,50 €');
  await expect(dialog.locator('[data-editor-summary-discount]')).toHaveText('-1,75 €');
  await expect(dialog.locator('[data-editor-summary-total]')).toHaveText('1,75 €');

  await affectedUnits.fill('1');
  await expect(dialog.locator('[data-field="lineTotalEuro"]')).toHaveJSProperty('value', '2.62');
  await expect(dialog.locator('[data-editor-summary-discount]')).toHaveText('-0,88 €');
  await expect(dialog.locator('[data-editor-summary-total]')).toHaveText('2,62 €');
});

test('invoice summary exposes calculation failure and recovers with the canonical backend total', async ({ page }, testInfo) => {
  await setup(page, 1280, 900);
  let rejectNextCalculation = true;
  await page.route('**/api/v1/receipts/calculate-line', async route => {
    if (!rejectNextCalculation) {
      await route.fallback();
      return;
    }
    rejectNextCalculation = false;
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Invalid discount' } }),
    });
  });

  const dialog = await openEditor(page);
  const affectedUnits = dialog.getByLabel('Unidades con descuento');
  const summary = dialog.locator('.receipt-line-editor-summary');
  const save = dialog.getByRole('button', { name: 'Guardar línea', exact: true });

  await affectedUnits.fill('2');
  await expect(dialog.locator('.receipt-line-derived-state')).toContainText('No se pudo calcular el total: Invalid discount');
  await expect(save).toBeDisabled();
  await expect(summary).toHaveAttribute('data-summary-state', 'error');
  await expect(summary).not.toHaveAttribute('data-summary-state', 'pending');
  await dialog.screenshot({ path: testInfo.outputPath('invoice-editor-calculation-error.png') });

  await affectedUnits.fill('1');
  await expect(dialog.locator('[data-field="lineTotalEuro"]')).toHaveJSProperty('value', '2.62');
  await expect(save).toBeEnabled();
  await expect(summary).toHaveAttribute('data-summary-state', 'ready');
  await expect(dialog.locator('[data-editor-summary-total]')).toHaveText('2,62 €');
});
