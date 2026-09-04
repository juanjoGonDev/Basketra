import { test, expect } from '@playwright/test';
import { fillRequiredReceiptStore } from './helpers/receipt-store.mjs';

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

function item(overrides = {}) {
  return {
    description: 'BEBIDA COCO',
    quantity: 1,
    unitPriceMinor: 175,
    lineTotalMinor: 175,
    confidence: 0.95,
    sourceLines: [1],
    ...overrides,
  };
}

async function setup(page, width = 1280, height = 900) {
  await page.setViewportSize({ width, height });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));
  await page.goto('/');
  await navigate(page, 'Tickets');
}

async function openReview(page, currentItems, options = {}) {
  await page.evaluate(async ({ items, currentOptions }) => {
    const { applyExtraction } = await import('/receipt-review.js');
    const declaredTotalMinor = items.reduce((sum, entry) => sum + entry.lineTotalMinor, 0);
    applyExtraction({
      originalText: currentOptions.originalText || 'RECEIPT TEST',
      final: {
        items,
        declaredTotalMinor,
        warnings: currentOptions.warnings || [],
        ...(currentOptions.unassignedDiscounts ? { unassignedDiscounts: currentOptions.unassignedDiscounts } : {}),
        review: {
          lines: items.map(entry => ({ ...entry, status: currentOptions.status || 'confirmed' })),
          total: { expectedMinor: declaredTotalMinor, differenceMinor: 0, valid: true },
        },
      },
    });
  }, { items: currentItems, currentOptions: options });
}

async function openEditor(page) {
  const dialog = page.locator('#receipt-line-dialog');
  if (!(await dialog.isVisible())) await page.locator('.receipt-line-compact').first().click();
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openManualEntry(page) {
  const manualEntry = page.locator('.manual-entry');
  if (!(await manualEntry.evaluate(element => element.open))) await manualEntry.locator('summary').click();
  await expect(manualEntry).toHaveJSProperty('open', true);
  return manualEntry;
}

async function makeConfirmable(page, storageKey = 'file_typed_discount') {
  await page.evaluate(key => import('/receipt-state.js').then(({ state }) => {
    const capture = {
      storageKey: key,
      contentHash: 'b'.repeat(64),
      mimeType: 'image/png',
      name: 'receipt.png',
      bytes: 128,
    };
    state.captures = [capture];
    state.pageStates.set(capture.storageKey, { status: 'completed' });
  }), storageKey);
  await fillRequiredReceiptStore(page);
}

test('percentage discounts use the backend calculation and render the total as semantic output', async ({ page }, testInfo) => {
  const calculations = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname === '/api/v1/receipts/calculate-line') {
      calculations.push(request.postDataJSON());
    }
  });

  await setup(page);
  await openReview(page, [item({
    lineTotalMinor: 87,
    discount: { type: 'percentage', basisPoints: 5_000 },
  })]);

  const row = page.locator('.receipt-item').first();
  const total = row.locator('[data-field="lineTotalEuro"]');
  await expect(row.locator('[data-field="discountType"]')).toHaveValue('percentage');
  await expect(row.locator('[data-field="discountValue"]')).toHaveValue('50');
  await expect(total).toHaveJSProperty('tagName', 'OUTPUT');
  await expect(total).toHaveJSProperty('value', '0.87');
  await expect(row).not.toContainText('Se actualiza al cambiar cantidad, precio o descuento.');
  await expect(page.locator('link[data-receipt-review-styles]')).toHaveAttribute('href', '/receipt-review.css');

  const editor = await openEditor(page);
  await editor.screenshot({ path: testInfo.outputPath('percentage-editor.png') });
  await editor.locator('[data-field="discountValue"]').fill('25');
  await expect(total).toHaveJSProperty('value', '1.31');
  await expect.poll(() => calculations.at(-1)?.discount).toEqual({ type: 'percentage', basisPoints: 2_500 });

  await editor.locator('[data-field="discountType"]').selectOption('amount');
  await expect(editor.locator('[data-field="discountValue"]')).toHaveValue('0');
  await expect.poll(() => calculations.at(-1)?.discount).toEqual({ type: 'amount', amountMinor: 0 });
  await expect(total).toHaveJSProperty('value', '1.75');
  await editor.locator('[data-field="discountValue"]').fill('0.25');
  await expect(total).toHaveJSProperty('value', '1.50');
  await expect.poll(() => calculations.at(-1)?.discount).toEqual({ type: 'amount', amountMinor: 25 });

  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(row.locator('[data-field="discountType"]')).toHaveValue('percentage');
  await expect(row.locator('[data-field="discountValue"]')).toHaveValue('50');
  await expect(total).toHaveJSProperty('value', '0.87');
});

test('pending and failed calculations keep Save line blocked until the latest result is valid', async ({ page }, testInfo) => {
  let releaseCalculation;
  let failNext = false;
  await page.route('**/api/v1/receipts/calculate-line', async route => {
    if (failNext) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Invalid discount' } }),
      });
      return;
    }
    await new Promise(resolve => { releaseCalculation = resolve; });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ lineTotalMinor: 350, discountMinor: 0 }),
    });
  });

  await setup(page);
  await openReview(page, [item()]);
  const editor = await openEditor(page);
  const save = editor.getByRole('button', { name: 'Guardar línea', exact: true });
  await editor.locator('[data-field="quantity"]').fill('2');
  await expect.poll(() => typeof releaseCalculation).toBe('function');
  await save.click();
  await expect(editor).toBeVisible();
  await expect(save).toHaveAttribute('aria-busy', 'true');

  releaseCalculation();
  await expect(editor).toBeHidden();

  const reopened = await openEditor(page);
  const reopenedSave = reopened.getByRole('button', { name: 'Guardar línea', exact: true });
  failNext = true;
  await reopened.locator('[data-field="discountType"]').selectOption('percentage');
  await reopened.locator('[data-field="discountValue"]').fill('50');
  const failedState = reopened.locator('.receipt-line-derived-state');
  await expect(failedState).toContainText('No se pudo calcular el total: Invalid discount');
  await expect(failedState).toHaveCSS('grid-column-start', '1');
  await expect(failedState).toHaveCSS('grid-column-end', '-1');
  await expect(reopenedSave).toBeDisabled();
  await expect(reopened).toBeVisible();
  await reopened.screenshot({ path: testInfo.outputPath('calculation-error.png') });

  failNext = false;
  releaseCalculation = undefined;
  await reopened.locator('[data-field="discountValue"]').fill('25');
  await expect.poll(() => typeof releaseCalculation).toBe('function');
  releaseCalculation();
  await expect(failedState).toContainText('Total actualizado.');
  await expect(reopenedSave).toBeEnabled();
  await reopenedSave.click();
  await expect(reopened).toBeHidden();
});

test('whole-ticket validation and confirmation wait for the latest derived calculation', async ({ page }) => {
  let releaseCalculation;
  let validationCalls = 0;
  let confirmationCalls = 0;
  await page.route('**/api/v1/receipts/calculate-line', async route => {
    await new Promise(resolve => { releaseCalculation = resolve; });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ lineTotalMinor: 350, discountMinor: 0 }),
    });
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname === '/api/v1/receipts/validate') validationCalls += 1;
    if (request.method() === 'POST' && url.pathname === '/api/v1/receipts/confirm') confirmationCalls += 1;
  });

  await setup(page);
  await openReview(page, [item()]);
  const manualEntry = await openManualEntry(page);
  await manualEntry.getByLabel('Total declarado (€)').fill('3.50');
  await makeConfirmable(page);
  await page.evaluate(() => {
    const input = document.querySelector('.receipt-item [data-field="quantity"]');
    input.value = '2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => typeof releaseCalculation).toBe('function');

  await manualEntry.getByRole('button', { name: 'Validar líneas e importes', exact: true }).click();
  await page.locator('#confirm-receipt').click();
  expect(validationCalls).toBe(0);
  expect(confirmationCalls).toBe(0);

  releaseCalculation();
  await expect.poll(() => validationCalls).toBeGreaterThan(0);
});

test('genuinely ambiguous discounts stay unassigned and visible for manual review', async ({ page }, testInfo) => {
  await setup(page);
  await openReview(page, [
    item(),
    item({ unitPriceMinor: 225, lineTotalMinor: 225, sourceLines: [2] }),
  ], {
    status: 'needs-review',
    originalText: 'BEBIDA COCO 1,75\nBEBIDA COCO 2,25\n50% dto BEBIDA COCO 0,88-',
    unassignedDiscounts: [{
      discount: { type: 'percentage', basisPoints: 5_000 },
      sourceLines: [3],
      description: 'BEBIDA COCO',
      reason: 'The same product label appears at two different prices, so ownership is unresolved.',
    }],
  });

  await expect(page.locator('[data-unassigned-discounts]')).toContainText('Hay un descuento pendiente de asignar');
  await expect(page.locator('[data-unassigned-discounts]')).toContainText('50%');
  await expect(page.locator('.receipt-item [data-field="discountType"]')).toHaveCount(2);
  await expect(page.locator('.receipt-item [data-field="discountType"]').nth(0)).toHaveValue('none');
  await expect(page.locator('.receipt-item [data-field="discountType"]').nth(1)).toHaveValue('none');
  await page.locator('#receipt-review').screenshot({ path: testInfo.outputPath('ambiguous-discount.png') });
});

test('typed discount editor has no horizontal overflow on mobile or desktop', async ({ page }, testInfo) => {
  await setup(page, 360, 800);
  await openReview(page, [item({
    lineTotalMinor: 87,
    discount: { type: 'percentage', basisPoints: 5_000 },
  })]);
  const editor = await openEditor(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect.poll(() => editor.locator('.quantity-row').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await editor.screenshot({ path: testInfo.outputPath('responsive-editor-mobile.png') });

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect.poll(() => editor.locator('.quantity-row').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(editor.locator('.receipt-line-result')).toBeVisible();
  await editor.screenshot({ path: testInfo.outputPath('responsive-editor-desktop.png') });
});

test('percentage corrections retain user intent while confirmation sends the typed discount', async ({ page }) => {
  let confirmationPayload;
  await page.route('**/api/v1/receipts/confirm', async route => {
    confirmationPayload = route.request().postDataJSON();
  });
  await setup(page);
  await openReview(page, [item({
    lineTotalMinor: 87,
    discount: { type: 'percentage', basisPoints: 5_000 },
  })]);
  await makeConfirmable(page);
  const manualEntry = await openManualEntry(page);
  await manualEntry.getByLabel('Total declarado (€)').fill('1.31');
  const editor = await openEditor(page);
  await editor.locator('[data-field="discountValue"]').fill('25');
  await expect(editor.locator('[data-field="lineTotalEuro"]')).toHaveJSProperty('value', '1.31');
  await editor.getByRole('button', { name: 'Guardar línea', exact: true }).click();
  await page.locator('#confirm-receipt').click();
  await expect.poll(() => confirmationPayload?.items?.[0]?.discount).toEqual({ type: 'percentage', basisPoints: 2_500 });
  expect(confirmationPayload.corrections).toEqual(expect.arrayContaining([{
    itemIndex: 0,
    field: 'discount',
    original: { type: 'percentage', basisPoints: 5_000 },
    corrected: { type: 'percentage', basisPoints: 2_500 },
  }]));
});
