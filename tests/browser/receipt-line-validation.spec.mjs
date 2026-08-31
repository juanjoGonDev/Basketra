import { test, expect } from '@playwright/test';

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

function item(description, lineTotalMinor, options = {}) {
  return {
    description,
    quantity: options.quantity ?? 1,
    unitPriceMinor: options.unitPriceMinor ?? lineTotalMinor,
    lineTotalMinor,
    ...(options.discountMinor === undefined ? {} : { discountMinor: options.discountMinor }),
    confidence: options.confidence ?? 0.9,
    sourceLines: [1],
  };
}

function observeValidationRequests(page, payloads) {
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() !== 'POST' || url.pathname !== '/api/v1/receipts/validate') return;
    payloads.push(request.postDataJSON());
  });
}

async function openReview(page, items, statuses) {
  await page.evaluate(async ({ currentItems, currentStatuses }) => {
    const { applyExtraction } = await import('/receipt-review.js');
    const declaredTotalMinor = currentItems.reduce((sum, entry) => sum + entry.lineTotalMinor, 0);
    applyExtraction({
      originalText: 'RECEIPT TEST',
      final: {
        items: currentItems,
        declaredTotalMinor,
        review: {
          lines: currentItems.map((entry, index) => ({
            ...entry,
            status: currentStatuses[index],
          })),
          total: { expectedMinor: declaredTotalMinor, differenceMinor: 0, valid: true },
        },
      },
    });
  }, { currentItems: items, currentStatuses: statuses });
}

async function makeReviewConfirmable(page, storageKey = 'file_receipt_validation_1') {
  await page.evaluate(key => {
    return import('/receipt-state.js').then(({ state }) => {
      const capture = {
        storageKey: key,
        contentHash: 'a'.repeat(64),
        mimeType: 'image/png',
        name: 'receipt.png',
        bytes: 128,
      };
      state.captures = [capture];
      state.pageStates.set(capture.storageKey, { status: 'completed' });
    });
  }, storageKey);
}

async function setup(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));
  await page.goto('/');
  await navigate(page, 'Tickets');
}

test('a review-required receipt line can be validated explicitly without editing other rows', async ({ page }) => {
  const validationPayloads = [];
  observeValidationRequests(page, validationPayloads);
  await setup(page);
  await openReview(page, [item('PAN', 150), item('LECHE', 120)], ['confirmed', 'needs-review']);

  await expect(page.getByRole('button', { name: 'Validar línea 2', exact: true })).toBeVisible();
  await expect(page.locator('.receipt-item').nth(1)).toContainText('Revisar');

  await page.getByRole('button', { name: 'Validar línea 2', exact: true }).click();

  await expect(page.locator('.receipt-item').nth(1)).toContainText('Validada');
  await expect(page.getByRole('button', { name: 'Validar línea 2', exact: true })).toHaveCount(0);
  await expect(page.locator('#receipt-state')).toHaveText('Línea 2 validada.');
  expect(validationPayloads).toHaveLength(1);
  expect(validationPayloads[0].items[0].description).toBe('PAN');
  expect(validationPayloads[0].items[1].description).toBe('LECHE');
  expect(validationPayloads[0].items[1]).not.toHaveProperty('discountMinor');
});

test('an extracted receipt discount stays visible, editable and part of canonical validation', async ({ page }) => {
  const validationPayloads = [];
  observeValidationRequests(page, validationPayloads);
  await setup(page);
  await openReview(page, [item('BEBIDA COCO', 175, { unitPriceMinor: 175, discountMinor: 25 })], ['arithmetic-mismatch']);

  const row = page.locator('.receipt-item').first();
  await expect(row.locator('[data-field="discountEuro"]')).toHaveValue('0.25');
  await expect(page.locator('.receipt-line-compact').first()).toContainText('Dto. 0,25 €');

  await page.getByRole('button', { name: 'Validar línea 1', exact: true }).click();
  await expect(page.locator('#receipt-state')).toContainText('Línea 1');
  await expect(page.locator('#receipt-state')).toContainText('1,50 €');
  await expect(page.locator('#receipt-state')).toContainText('1,75 €');
  expect(validationPayloads.at(-1).items[0].discountMinor).toBe(25);

  await page.locator('.receipt-line-compact').first().click();
  const editor = page.locator('#receipt-line-dialog');
  await expect(editor.locator('[data-field="discountEuro"]')).toHaveValue('0.25');
  await editor.locator('[data-field="discountEuro"]').fill('0.10');
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(row.locator('[data-field="discountEuro"]')).toHaveValue('0.25');

  await page.locator('.receipt-line-compact').first().click();
  await editor.locator('[data-field="discountEuro"]').fill('0.00');
  await editor.getByRole('button', { name: 'Guardar línea', exact: true }).click();
  await page.getByRole('button', { name: 'Validar línea 1', exact: true }).click();

  await expect(page.locator('.receipt-item').first()).toContainText('Validada');
  await expect(page.locator('#receipt-state')).toHaveText('Línea 1 validada.');
  expect(validationPayloads.at(-1).items[0].discountMinor).toBe(0);
});

test('a missing receipt discount can be added, validated and confirmed', async ({ page }) => {
  const validationPayloads = [];
  let confirmationPayload;
  observeValidationRequests(page, validationPayloads);
  await page.route('**/api/v1/receipts/confirm', async route => {
    confirmationPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ receiptId: 'receipt_discount_manual' }),
    });
  });
  await setup(page);
  await openReview(page, [item('BEBIDA COCO', 150, { unitPriceMinor: 175 })], ['arithmetic-mismatch']);

  const row = page.locator('.receipt-item').first();
  await expect(row.locator('[data-field="discountEuro"]')).toHaveValue('0.00');
  await expect(page.locator('.receipt-line-compact').first()).not.toContainText('Dto.');

  await page.getByRole('button', { name: 'Validar línea 1', exact: true }).click();
  expect(validationPayloads.at(-1).items[0]).not.toHaveProperty('discountMinor');
  await expect(page.locator('#receipt-state')).toContainText('1,75 €');
  await expect(page.locator('#receipt-state')).toContainText('1,50 €');

  await page.locator('.receipt-line-compact').first().click();
  const editor = page.locator('#receipt-line-dialog');
  await editor.locator('[data-field="discountEuro"]').fill('0.25');
  await editor.getByRole('button', { name: 'Guardar línea', exact: true }).click();
  await expect(page.locator('.receipt-line-compact').first()).toContainText('Dto. 0,25 €');

  await page.getByRole('button', { name: 'Validar línea 1', exact: true }).click();
  await expect(page.locator('.receipt-item').first()).toContainText('Validada');
  await expect(page.locator('#receipt-state')).toHaveText('Línea 1 validada.');
  expect(validationPayloads.at(-1).items[0].discountMinor).toBe(25);

  await makeReviewConfirmable(page, 'file_receipt_discount_manual');
  await page.getByRole('button', { name: 'Confirmar e importar', exact: true }).click();

  await expect(page.locator('#receipt-state')).toHaveText('Ticket importado: receipt_discount_manual');
  expect(confirmationPayload.items[0].discountMinor).toBe(25);
  expect(confirmationPayload.corrections).toContainEqual({
    itemIndex: 0,
    field: 'discountMinor',
    corrected: 25,
  });
});

test('final confirmation stops before import when canonical validation still rejects a line', async ({ page }) => {
  let confirmCalls = 0;
  await page.route('**/api/v1/receipts/confirm', async route => {
    confirmCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ receiptId: 'should-not-import' }),
    });
  });
  await setup(page);
  await openReview(page, [item('BEBIDA COCO', 175, { unitPriceMinor: 175, discountMinor: 25 })], ['arithmetic-mismatch']);
  await makeReviewConfirmable(page);

  await page.getByRole('button', { name: 'Confirmar e importar', exact: true }).click();

  await expect(page.locator('#receipt-state')).toContainText('Línea 1');
  await expect(page.locator('#receipt-state')).toContainText('antes de importar');
  await expect(page.getByRole('button', { name: 'Validar línea 1', exact: true })).toBeFocused();
  expect(confirmCalls).toBe(0);
});
