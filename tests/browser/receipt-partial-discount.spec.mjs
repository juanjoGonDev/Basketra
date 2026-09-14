import { test, expect } from '@playwright/test';

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

async function setup(page, width = 360, height = 800) {
  await page.setViewportSize({ width, height });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));
  await page.goto('/');
  await navigate(page, 'Tickets');
}

async function openPartialDiscountReview(page) {
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

test('partial-unit-discount-editor', async ({ page }, testInfo) => {
  const calculations = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname === '/api/v1/receipts/calculate-line') {
      calculations.push(request.postDataJSON());
    }
  });

  await setup(page);
  await openPartialDiscountReview(page);

  const row = page.locator('.receipt-item');
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-field="quantity"]')).toHaveValue('2');
  await expect(row.locator('[data-field="discountType"]')).toHaveValue('percentage');
  await expect(row.locator('[data-field="discountValue"]')).toHaveValue('50');
  await expect(row.locator('[data-field="discountQuantity"]')).toHaveValue('1');
  await expect(row.locator('[data-field="lineTotalEuro"]')).toHaveJSProperty('value', '2.62');
  await expect(row.locator('[data-receipt-discount-summary]')).toHaveText('Dto. 50% · 1 de 2 uds.');

  const editor = page.locator('#receipt-line-dialog');
  await page.locator('.receipt-line-compact').click();
  await expect(editor).toBeVisible();
  const affectedUnits = editor.locator('[data-field="discountQuantity"]');
  await expect(affectedUnits).toBeVisible();
  await expect(affectedUnits).toHaveAttribute('min', '1');
  await expect(affectedUnits).toHaveAttribute('max', '2');
  await expect(editor.locator('[data-discount-quantity-help]')).toHaveText('de 2 unidades');
  await expect.poll(() => editor.locator('.quantity-row').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await editor.screenshot({ path: testInfo.outputPath('partial-unit-discount-mobile.png') });

  await affectedUnits.fill('2');
  await expect.poll(() => calculations.at(-1)?.discount).toEqual({ type: 'percentage', basisPoints: 5_000 });
  await expect(editor.locator('[data-field="lineTotalEuro"]')).toHaveJSProperty('value', '1.75');

  await affectedUnits.fill('1');
  await expect.poll(() => calculations.at(-1)?.discount).toEqual({ type: 'percentage', basisPoints: 5_000, quantity: 1 });
  await expect(editor.locator('[data-field="lineTotalEuro"]')).toHaveJSProperty('value', '2.62');

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect.poll(() => editor.locator('.quantity-row').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(editor.locator('.receipt-line-result__value')).toHaveCSS('white-space', 'nowrap');
  await expect(editor.locator('[data-field="lineTotalEuro"]')).toHaveCSS('white-space', 'nowrap');
  await editor.screenshot({ path: testInfo.outputPath('partial-unit-discount-desktop.png') });
});
