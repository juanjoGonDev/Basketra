import { test, expect } from '@playwright/test';

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

async function setup(page) {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));
  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.evaluate(async () => {
    const { applyExtraction } = await import('/receipt-review.js');
    applyExtraction({
      originalText: 'RECEIPT TEST',
      final: {
        items: [{
          description: 'BEBIDA COCO',
          quantity: 1,
          unitPriceMinor: 175,
          lineTotalMinor: 87,
          discount: { type: 'percentage', basisPoints: 5_000 },
          confidence: 0.95,
          sourceLines: [1],
        }],
        declaredTotalMinor: 87,
        warnings: [],
        review: {
          lines: [{
            description: 'BEBIDA COCO',
            quantity: 1,
            unitPriceMinor: 175,
            lineTotalMinor: 87,
            discount: { type: 'percentage', basisPoints: 5_000 },
            confidence: 0.95,
            sourceLines: [1],
            status: 'confirmed',
          }],
          total: { expectedMinor: 87, differenceMinor: 0, valid: true },
        },
      },
    });
  });
}

test('cancel invalidates an edited calculation before a late response can overwrite the restored total', async ({ page }) => {
  let releaseEditedCalculation;
  let editedCalculationStarted = false;
  let editedCalculationSettled = false;
  let restoredCalculationSeen = false;

  await page.route('**/api/v1/receipts/calculate-line', async route => {
    const payload = route.request().postDataJSON();
    if (payload?.discount?.type === 'percentage' && payload.discount.basisPoints === 2_500) {
      editedCalculationStarted = true;
      await new Promise(resolve => { releaseEditedCalculation = resolve; });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ lineTotalMinor: 131, discountMinor: 44 }),
      }).catch(() => {});
      editedCalculationSettled = true;
      return;
    }

    if (payload?.discount?.type === 'percentage' && payload.discount.basisPoints === 5_000) {
      restoredCalculationSeen = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ lineTotalMinor: 87, discountMinor: 88 }),
      });
      return;
    }

    await route.continue();
  });

  await setup(page);
  const row = page.locator('.receipt-item').first();
  const total = row.locator('[data-field="lineTotalEuro"]');
  await row.locator('.receipt-line-compact').click();
  const dialog = page.locator('#receipt-line-dialog');
  await expect(dialog).toBeVisible();

  await dialog.locator('[data-field="discountValue"]').fill('25');
  await expect.poll(() => editedCalculationStarted).toBe(true);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect.poll(() => restoredCalculationSeen).toBe(true);
  await expect(row.locator('[data-field="discountType"]')).toHaveValue('percentage');
  await expect(row.locator('[data-field="discountValue"]')).toHaveValue('50');
  await expect(total).toHaveJSProperty('value', '0.87');

  releaseEditedCalculation?.();
  await expect.poll(() => editedCalculationSettled).toBe(true);
  await expect(total).toHaveJSProperty('value', '0.87');
});
