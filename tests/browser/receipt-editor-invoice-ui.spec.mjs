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

async function elementBox(locator) {
  const box = await locator.boundingBox();
  return box && {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}

async function settleLayout(page) {
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function mobileSheetGeometry(dialog, actions) {
  const [dialogBox, actionsBox] = await Promise.all([
    elementBox(dialog),
    elementBox(actions),
  ]);
  if (!dialogBox || !actionsBox) return { dialogBox, actionsBox, bottomGap: null };
  const dialogBottom = dialogBox.y + dialogBox.height;
  const actionsBottom = actionsBox.y + actionsBox.height;
  return {
    dialogBox,
    actionsBox,
    dialogBottom,
    actionsBottom,
    bottomGap: dialogBottom - actionsBottom,
  };
}

function sameRow(first, second, tolerance = 4) {
  return first && second && Math.abs(first.y - second.y) <= tolerance;
}

function sameWidth(first, second, tolerance = 4) {
  return first && second && Math.abs(first.width - second.width) <= tolerance;
}

function sameSize(first, second, tolerance = 1) {
  return first
    && second
    && Math.abs(first.width - second.width) <= tolerance
    && Math.abs(first.height - second.height) <= tolerance;
}

function containedBy(inner, outer, tolerance = 1) {
  return inner
    && outer
    && inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.width <= outer.x + outer.width + tolerance
    && inner.y + inner.height <= outer.y + outer.height + tolerance;
}

test('invoice-editor-desktop', async ({ page }, testInfo) => {
  await setup(page, 1280, 900);
  const dialog = await openEditor(page);

  await expect(dialog.getByRole('heading', { name: '1. Producto', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '2. Detalle de compra', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '3. Descuento', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Resumen', exact: true })).toBeVisible();
  await expect(dialog.locator('[data-editor-section="producto"] [data-local-icon="package"]')).toBeVisible();
  await expect(dialog.locator('[data-editor-section="descuento"] [data-local-icon="tag"]')).toBeVisible();
  await expect(dialog.locator('[data-editor-section="producto"] [data-icon="package"]')).toHaveCount(0);
  await expect(dialog.locator('[data-editor-section="descuento"] [data-icon="tag"]')).toHaveCount(0);
  await expect(dialog.locator('[data-editor-validation]')).toHaveText('Validada');
  await expect(dialog.locator('[data-editor-summary-validation]')).toContainText('Total validado');

  await expect(dialog.getByText('Precio unitario', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Tipo', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Valor', { exact: true })).toBeVisible();
  await expect(dialog.locator('[data-field="unitPriceEuro"]')).toHaveValue('1,75');
  await expect(dialog.locator('[data-editor-affix="unit-price"]')).toContainText('€');
  await expect(dialog.locator('[data-editor-affix="discount-value"]')).toContainText('%');
  await expect(dialog.locator('[data-editor-affix="discount-quantity"]')).toContainText('de 2');

  await expect(dialog.locator('[data-editor-summary-base]')).toHaveText('3,50 €');
  await expect(dialog.locator('[data-editor-summary-discount]')).toHaveText('-0,88 €');
  await expect(dialog.locator('[data-field="lineTotalEuro"]')).toHaveJSProperty('value', '2.62');
  await expect(dialog.locator('[data-editor-summary-total]')).toHaveText('2,62 €');
  await expect(dialog.locator('.receipt-editor-summary__total dt')).toHaveCSS('white-space', 'nowrap');
  await expect(dialog.locator('.receipt-editor-summary__stamp')).toBeVisible();

  const layout = dialog.locator('.receipt-line-editor-layout');
  const purchaseDetail = dialog.locator('.quantity-row');
  const summary = dialog.locator('.receipt-line-editor-summary');
  const deleteButton = dialog.getByRole('button', { name: 'Eliminar', exact: true });
  const cancelButton = dialog.getByRole('button', { name: 'Cancelar', exact: true });
  const saveButton = dialog.getByRole('button', { name: 'Guardar línea', exact: true });
  await expect(layout).toHaveCSS('display', 'grid');
  await expect.poll(async () => {
    const box = await elementBox(dialog);
    return Boolean(box && box.width >= 800 && box.width <= 850 && box.height >= 610 && box.height <= 700);
  }).toBe(true);
  await expect.poll(async () => {
    const [purchaseBox, summaryBox] = await Promise.all([elementBox(purchaseDetail), elementBox(summary)]);
    return Boolean(
      purchaseBox
      && summaryBox
      && summaryBox.x > purchaseBox.x + purchaseBox.width
      && summaryBox.width >= 220
      && summaryBox.width <= 270,
    );
  }).toBe(true);
  await expect.poll(async () => {
    const [deleteBox, cancelBox, saveBox] = await Promise.all([
      elementBox(deleteButton),
      elementBox(cancelButton),
      elementBox(saveButton),
    ]);
    return Boolean(
      sameRow(deleteBox, cancelBox)
      && sameRow(cancelBox, saveBox)
      && saveBox
      && deleteBox
      && cancelBox
      && saveBox.width > deleteBox.width
      && saveBox.width > cancelBox.width,
    );
  }).toBe(true);
  await expectNoHorizontalOverflow(page, dialog);

  await dialog.screenshot({ path: testInfo.outputPath('invoice-editor-desktop.png') });
});

test('invoice-editor-mobile', async ({ page }, testInfo) => {
  await setup(page, 360, 800);
  const dialog = await openEditor(page);

  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, dialog);
    await expect(dialog.locator('[data-editor-summary-total]')).toHaveText('2,62 €');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const purchaseDetail = dialog.locator('.quantity-row');
  const summary = dialog.locator('.receipt-line-editor-summary');
  const actions = dialog.locator('.receipt-invoice-dialog__actions');
  const slot = dialog.locator('#receipt-line-editor-slot');
  const quantityField = dialog.locator('[data-field="quantity"]').locator('..');
  const unitPriceField = dialog.locator('[data-field="unitPriceEuro"]').locator('..').locator('..');
  const discountTypeField = dialog.locator('.receipt-discount-type-field');
  const discountValueField = dialog.locator('.receipt-discount-value-field');
  const discountQuantityField = dialog.locator('.receipt-discount-quantity-field');
  const deleteButton = dialog.getByRole('button', { name: 'Eliminar', exact: true });
  const cancelButton = dialog.getByRole('button', { name: 'Cancelar', exact: true });
  const saveButton = dialog.getByRole('button', { name: 'Guardar línea', exact: true });

  await expect(dialog.locator('[data-field="unitPriceEuro"]')).toHaveValue('1,75');
  await expect.poll(async () => {
    const [purchaseBox, summaryBox] = await Promise.all([elementBox(purchaseDetail), elementBox(summary)]);
    if (!purchaseBox || !summaryBox) return false;
    const sameColumn = Math.abs(summaryBox.x - purchaseBox.x) <= 1
      && Math.abs(summaryBox.width - purchaseBox.width) <= 1;
    return sameColumn && summaryBox.y >= purchaseBox.y + purchaseBox.height;
  }).toBe(true);
  await summary.scrollIntoViewIfNeeded();
  await expect.poll(async () => {
    const [summaryBox, actionsBox] = await Promise.all([elementBox(summary), elementBox(actions)]);
    return Boolean(summaryBox && actionsBox && summaryBox.y + summaryBox.height <= actionsBox.y + 1);
  }).toBe(true);
  await expect.poll(async () => {
    const [quantityBox, unitPriceBox, typeBox, valueBox, affectedBox] = await Promise.all([
      elementBox(quantityField),
      elementBox(unitPriceField),
      elementBox(discountTypeField),
      elementBox(discountValueField),
      elementBox(discountQuantityField),
    ]);
    return Boolean(
      sameRow(quantityBox, unitPriceBox)
      && sameWidth(quantityBox, unitPriceBox)
      && sameRow(valueBox, affectedBox)
      && sameWidth(valueBox, affectedBox)
      && typeBox
      && valueBox
      && typeBox.y + typeBox.height <= valueBox.y,
    );
  }).toBe(true);
  await expect(dialog.locator('.receipt-editor-summary__stamp')).toBeHidden();
  await expect(dialog.locator('[data-editor-affix="discount-quantity"]')).toContainText('de 2');
  await expect.poll(async () => {
    const [deleteBox, cancelBox, saveBox] = await Promise.all([
      elementBox(deleteButton),
      elementBox(cancelButton),
      elementBox(saveButton),
    ]);
    return Boolean(
      deleteBox
      && cancelBox
      && saveBox
      && deleteBox.y < cancelBox.y
      && cancelBox.y < saveBox.y
      && sameWidth(deleteBox, cancelBox)
      && sameWidth(cancelBox, saveBox),
    );
  }).toBe(true);
  await expect(dialog.getByLabel('Unidades con descuento')).toBeVisible();
  await expect(saveButton).toBeVisible();
  await expect(cancelButton).toBeVisible();
  await expect(deleteButton).toBeVisible();

  await page.setViewportSize({ width: 390, height: 1024 });
  await slot.evaluate(element => { element.scrollTop = 0; });
  await settleLayout(page);
  const geometry = await mobileSheetGeometry(dialog, actions);
  console.log(`[invoice-editor-mobile geometry] ${JSON.stringify(geometry)}`);
  expect(geometry.dialogBox, 'mobile invoice dialog must have a measurable box').not.toBeNull();
  expect(geometry.actionsBox, 'mobile invoice actions must have a measurable box').not.toBeNull();
  expect(geometry.dialogBox?.y ?? -2, `dialog box: ${JSON.stringify(geometry)}`).toBeGreaterThanOrEqual(-1);
  expect(geometry.actionsBox?.y ?? -2, `actions box: ${JSON.stringify(geometry)}`).toBeGreaterThanOrEqual(geometry.dialogBox?.y ?? -1);
  expect(geometry.actionsBottom ?? Number.POSITIVE_INFINITY, `actions overflow dialog: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual((geometry.dialogBottom ?? 0) + 1);
  expect(Math.abs(geometry.bottomGap ?? Number.POSITIVE_INFINITY), `unexpected residual bottom gap: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(4);
  await expectNoHorizontalOverflow(page, dialog);
  await summary.scrollIntoViewIfNeeded();
  await expect.poll(async () => {
    const [summaryBox, actionsBox] = await Promise.all([elementBox(summary), elementBox(actions)]);
    return Boolean(summaryBox && actionsBox && summaryBox.y + summaryBox.height <= actionsBox.y + 1);
  }).toBe(true);
  await dialog.screenshot({ path: testInfo.outputPath('invoice-editor-mobile.png') });
});

test('invoice summary stays mounted and stable while a calculation is pending', async ({ page }) => {
  await setup(page, 1280, 900);
  const dialog = await openEditor(page);
  const summary = dialog.locator('.receipt-line-editor-summary');
  const affectedUnits = dialog.getByLabel('Unidades con descuento');
  const displayedTotal = dialog.locator('[data-editor-summary-total]');
  let releaseCalculation = () => {};
  const calculationGate = new Promise(resolve => { releaseCalculation = resolve; });
  let heldRequest = false;

  await summary.evaluate(element => { element.dataset.stabilityProbe = 'same-node'; });
  const settledBox = await elementBox(summary);
  await page.route('**/api/v1/receipts/calculate-line', async route => {
    if (heldRequest) {
      await route.fallback();
      return;
    }
    heldRequest = true;
    const response = await route.fetch();
    await calculationGate;
    await route.fulfill({ response });
  });

  try {
    await affectedUnits.fill('2');
    await expect(summary).toHaveAttribute('data-summary-state', 'pending');
    await expect(summary.locator('[data-editor-summary-progress]')).toContainText('Calculando');
    await expect(displayedTotal).toHaveText('2,62 €');
    await expect(summary).toHaveAttribute('data-stability-probe', 'same-node');
    await settleLayout(page);
    const pendingBox = await elementBox(summary);
    expect(sameSize(settledBox, pendingBox), `summary resized while pending: ${JSON.stringify({ settledBox, pendingBox })}`).toBe(true);

    releaseCalculation();
    await expect(dialog.locator('[data-field="lineTotalEuro"]')).toHaveJSProperty('value', '1.75');
    await expect(summary).toHaveAttribute('data-summary-state', 'ready');
    await expect(displayedTotal).toHaveText('1,75 €');
    await expect(summary).toHaveAttribute('data-stability-probe', 'same-node');
    await settleLayout(page);
    const completedBox = await elementBox(summary);
    expect(sameSize(settledBox, completedBox), `summary resized after calculation: ${JSON.stringify({ settledBox, completedBox })}`).toBe(true);
  } finally {
    releaseCalculation();
  }
});

test('invoice summary contains extreme localized values without overlap or overflow', async ({ page }) => {
  await setup(page, 1280, 900);
  const dialog = await openEditor(page);
  const summary = dialog.locator('.receipt-line-editor-summary');
  const quantity = dialog.locator('[data-field="quantity"]');
  const unitPrice = dialog.locator('[data-field="unitPriceEuro"]');
  const discountValue = dialog.locator('[data-field="discountValue"]');
  const affectedUnits = dialog.getByLabel('Unidades con descuento');
  const expectedAmount = '9.999.899.900.001,00 €';

  await quantity.fill('99999');
  await unitPrice.fill('99999999');
  await discountValue.fill('100');
  await affectedUnits.fill('99999');

  await expect(dialog.locator('[data-field="lineTotalEuro"]')).toHaveJSProperty('value', '0');
  await expect(dialog.locator('[data-editor-summary-base]')).toHaveText(expectedAmount);
  await expect(dialog.locator('[data-editor-summary-discount]')).toHaveText(`-${expectedAmount}`);
  await expect(dialog.locator('[data-editor-summary-total]')).toHaveText('0,00 €');
  await expect(summary).toHaveAttribute('data-summary-state', 'ready');
  await expectNoHorizontalOverflow(page, dialog);

  const rows = summary.locator('.receipt-editor-summary__row');
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    const [rowBox, labelBox, valueBox] = await Promise.all([
      elementBox(row),
      elementBox(row.locator('dt')),
      elementBox(row.locator('dd')),
    ]);
    expect(containedBy(labelBox, rowBox), `summary label escaped row ${index}: ${JSON.stringify({ rowBox, labelBox })}`).toBe(true);
    expect(containedBy(valueBox, rowBox), `summary value escaped row ${index}: ${JSON.stringify({ rowBox, valueBox })}`).toBe(true);
    expect(valueBox && labelBox && valueBox.y >= labelBox.y + labelBox.height - 1, `desktop summary label/value overlap in row ${index}: ${JSON.stringify({ labelBox, valueBox })}`).toBe(true);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page, dialog);
  await summary.scrollIntoViewIfNeeded();
  const summaryBox = await elementBox(summary);
  for (const selector of ['[data-editor-summary-base]', '[data-editor-summary-discount]', '[data-editor-summary-total]']) {
    const valueBox = await elementBox(summary.locator(selector));
    expect(containedBy(valueBox, summaryBox), `mobile extreme amount escaped summary: ${JSON.stringify({ selector, summaryBox, valueBox })}`).toBe(true);
  }
});

test('invoice summary follows the backend-derived total without treating description edits as calculations', async ({ page }) => {
  await setup(page, 1280, 900);
  const dialog = await openEditor(page);
  const summary = dialog.locator('.receipt-line-editor-summary');
  const affectedUnits = dialog.getByLabel('Unidades con descuento');

  await dialog.locator('[data-field="description"]').fill('BEBIDA COCO SIN AZÚCAR');
  await expect(summary).toHaveAttribute('data-summary-state', 'ready');
  await expect(dialog.locator('[data-editor-summary-total]')).toHaveText('2,62 €');

  await affectedUnits.fill('2');
  await expect(dialog.locator('[data-field="lineTotalEuro"]')).toHaveJSProperty('value', '1.75');
  await expect(dialog.locator('[data-editor-summary-base]')).toHaveText('3,50 €');
  await expect(dialog.locator('[data-editor-summary-discount]')).toHaveText('-1,75 €');
  await expect(dialog.locator('[data-editor-summary-total]')).toHaveText('1,75 €');
  await expect(dialog.locator('[data-editor-affix="discount-quantity"]')).toContainText('de 2');

  await affectedUnits.fill('1');
  await expect(dialog.locator('[data-field="lineTotalEuro"]')).toHaveJSProperty('value', '2.62');
  await expect(dialog.locator('[data-editor-summary-discount]')).toHaveText('-0,88 €');
  await expect(dialog.locator('[data-editor-summary-total]')).toHaveText('2,62 €');
});

test('invoice-editor-error', async ({ page }, testInfo) => {
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
  const headerValidation = dialog.locator('[data-editor-validation]');
  const summaryValidation = dialog.locator('[data-editor-summary-validation]');
  const save = dialog.getByRole('button', { name: 'Guardar línea', exact: true });

  await affectedUnits.fill('2');
  await expect(dialog.locator('.receipt-line-derived-state')).toContainText('No se pudo calcular el total: Invalid discount');
  await expect(save).toBeDisabled();
  await expect(summary).toHaveAttribute('data-summary-state', 'error');
  await expect(summary).not.toHaveAttribute('data-summary-state', 'pending');
  await expect(headerValidation).toBeHidden();
  await expect(summaryValidation).toBeHidden();
  await dialog.screenshot({ path: testInfo.outputPath('invoice-editor-calculation-error.png') });

  await affectedUnits.fill('1');
  await expect(dialog.locator('[data-field="lineTotalEuro"]')).toHaveJSProperty('value', '2.62');
  await expect(save).toBeEnabled();
  await expect(summary).toHaveAttribute('data-summary-state', 'ready');
  await expect(dialog.locator('[data-editor-summary-total]')).toHaveText('2,62 €');
  await expect(headerValidation).toBeVisible();
  await expect(headerValidation).toHaveText('Validada');
  await expect(summaryValidation).toBeVisible();
  await expect(summaryValidation).toContainText('Total validado');
});
