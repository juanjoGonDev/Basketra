import { test, expect } from '@playwright/test';

const baseTicket = {
  id: 'ticket_20260902',
  retailerName: 'Mercado Central',
  storeId: 'store_central',
  storeName: 'Mercado Central · Centro',
  declaredTotalMinor: 150,
  purchasedAt: '2026-09-02T18:30:00.000Z',
  createdAt: '2026-09-02T18:31:00.000Z',
  updatedAt: '2026-09-02T18:31:00.000Z',
  paymentStatus: 'paid',
  paymentMethod: 'Tarjeta',
  notes: 'Compra semanal',
  taxMinor: 0,
  receiptDiscountMinor: 0,
  itemCount: 1,
  items: [{
    id: 'receipt_item_milk',
    originalDescription: 'LECHE ENTERA',
    description: 'Leche entera',
    categoryId: 'category_dairy',
    categoryName: 'Lácteos',
    quantity: 1,
    unit: 'unit',
    unitPriceMinor: 150,
    lineTotalMinor: 150,
    status: 'confirmed',
    confidence: 1,
  }],
};

function calculateLine(payload) {
  const subtotal = payload.quantity * payload.unitPriceMinor;
  let discountMinor = 0;
  if (payload.discount?.type === 'amount') {
    discountMinor = payload.discount.amountMinor;
  } else if (payload.discount?.type === 'percentage') {
    const affected = payload.discount.quantity ?? payload.quantity;
    discountMinor = Math.round((affected * payload.unitPriceMinor * payload.discount.basisPoints) / 10_000);
  }
  return { lineTotalMinor: subtotal - discountMinor, discountMinor };
}

function ticketFromPatch(payload) {
  const items = payload.items.map((item, index) => {
    const calculated = calculateLine(item);
    return {
      ...item,
      id: item.id || `receipt_item_new_${index}`,
      originalDescription: item.id ? 'LECHE ENTERA' : item.description,
      categoryName: item.categoryId === 'category_dairy' ? 'Lácteos' : undefined,
      lineTotalMinor: calculated.lineTotalMinor,
      status: 'confirmed',
      confidence: 1,
    };
  });
  const linesMinor = items.reduce((total, item) => total + item.lineTotalMinor, 0);
  return {
    ...baseTicket,
    ...payload,
    items,
    itemCount: items.length,
    declaredTotalMinor: linesMinor + payload.taxMinor - payload.receiptDiscountMinor,
    updatedAt: '2026-09-02T19:00:00.000Z',
  };
}

async function installRoutes(page) {
  let ticket = structuredClone(baseTicket);
  let patchPayload;
  let deleted = false;
  const calculationRequests = [];

  await page.route('**/api/v1/categories', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ categories: [{ id: 'category_dairy', name: 'Lácteos', color: '#5d8bf4' }] }),
  }));
  await page.route('**/api/v1/inventory/stores?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      stores: [{ id: 'store_central', name: 'Mercado Central · Centro', retailerName: 'Mercado Central' }],
      total: 1,
      offset: 0,
      limit: 100,
      hasMore: false,
    }),
  }));
  await page.route('**/api/v1/inventory/tickets?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      tickets: deleted ? [] : [{ ...ticket, items: undefined }],
      total: deleted ? 0 : 1,
      offset: 0,
      limit: 12,
      hasMore: false,
      summary: {
        ticketCount: deleted ? 0 : 1,
        totalSpentMinor: deleted ? 0 : ticket.declaredTotalMinor,
        itemCount: deleted ? 0 : ticket.itemCount,
        averageTicketMinor: deleted ? 0 : ticket.declaredTotalMinor,
      },
    }),
  }));
  await page.route(/\/api\/v1\/inventory\/tickets\/ticket_20260902$/, async route => {
    if (route.request().method() === 'DELETE') {
      deleted = true;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (route.request().method() === 'PATCH') {
      patchPayload = route.request().postDataJSON();
      ticket = ticketFromPatch(patchPayload);
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ticket }) });
  });
  await page.route('**/api/v1/inventory/tickets/ticket_20260902/delete-impact', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      impact: {
        ticket: { id: ticket.id },
        itemCount: ticket.itemCount,
        captures: 1,
        extractions: 1,
        corrections: 2,
        externalEvidence: 0,
        retainedPriceObservations: 1,
        canDelete: true,
        warning: 'Deleting this ticket permanently removes its receipt evidence.',
      },
    }),
  }));
  await page.route('**/api/v1/receipts/calculate-line', async route => {
    const payload = route.request().postDataJSON();
    calculationRequests.push(payload);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(calculateLine(payload)) });
  });

  return {
    getPatch: () => patchPayload,
    getCalculations: () => calculationRequests,
    wasDeleted: () => deleted,
  };
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

test('ticket history supports mobile list, keyboard detail, canonical line calculation and evidence-aware delete', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const observed = await installRoutes(page);
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()); });

  await page.goto('/');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
  await page.getByRole('button', { name: 'Historial', exact: true }).click();

  await expect(page).toHaveURL(/\/tickets\/history$/);
  await expect(page.getByRole('heading', { name: 'Historial de tickets' })).toBeVisible();
  await expect(page.locator('#ticket-summary-count')).toHaveText('1');
  await expect(page.locator('#ticket-summary-spent')).toContainText('1,50');
  await expect(page.locator('#ticket-history-range')).toHaveText('1-1 de 1');
  await expectNoHorizontalOverflow(page);
  await page.locator('.view[data-view="ticket-history"]').screenshot({ path: testInfo.outputPath('ticket-history-mobile.png') });

  const row = page.locator('[data-ticket-action="open"][data-ticket-id="ticket_20260902"]');
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/tickets\/history\/ticket_20260902$/);
  await expect(page.locator('#ticket-editor-title')).toContainText('ticket_20260902');
  await expect(page.locator('#ticket-editor-total')).toContainText('1,50');

  await page.getByRole('button', { name: 'Editar línea 1' }).click();
  const lineDialog = page.locator('#historical-ticket-line-dialog');
  await expect(lineDialog).toBeVisible();
  await lineDialog.locator('#historical-ticket-line-quantity').fill('2');
  await lineDialog.locator('#historical-ticket-line-unit-price').fill('1.50');
  await lineDialog.locator('#historical-ticket-line-discount-type').selectOption('amount');
  await lineDialog.locator('#historical-ticket-line-discount-value').fill('0.20');
  await expect.poll(() => observed.getCalculations().at(-1)).toEqual({
    quantity: 2,
    unitPriceMinor: 150,
    discount: { type: 'amount', amountMinor: 20, quantity: 1 },
  });
  await expect(lineDialog.locator('#historical-ticket-line-total')).toHaveJSProperty('value', '2.80');
  await expect(lineDialog.locator('[data-editor-summary-total]')).toContainText('2,80');
  await lineDialog.getByRole('button', { name: 'Guardar línea' }).click();
  await expect(lineDialog).toBeHidden();
  await expect(page.locator('#ticket-editor-status')).toHaveText('Sin guardar');

  await page.getByRole('button', { name: 'Añadir artículo' }).click();
  await expect(lineDialog).toBeVisible();
  await expect(lineDialog.getByRole('heading', { name: 'Añadir artículo' })).toBeVisible();
  await expect(lineDialog.locator('[data-editor-section="producto"]')).toHaveText('1. Producto');
  await expect(lineDialog.locator('[data-editor-section="detalle-de-compra"]')).toHaveText('2. Detalle de compra');
  await expect(lineDialog.locator('[data-editor-section="descuento"]')).toHaveText('3. Descuento');
  await expect(lineDialog.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  await expect(lineDialog.locator('[data-editor-summary-validation]')).toContainText('Revisar total');
  await lineDialog.screenshot({ path: testInfo.outputPath('ticket-line-add-mobile.png') });
  await lineDialog.locator('#historical-ticket-line-description').fill('Pan integral');
  await lineDialog.locator('#historical-ticket-line-quantity').fill('2');
  await lineDialog.locator('#historical-ticket-line-unit-price').fill('1.20');
  await expect.poll(() => observed.getCalculations().at(-1)).toMatchObject({
    quantity: 2,
    unitPriceMinor: 120,
  });
  await expect(lineDialog.locator('[data-editor-summary-total]')).toContainText('2,40');
  await expect(lineDialog.locator('[data-editor-summary-validation]')).toContainText('Total validado');
  await lineDialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(lineDialog).toBeHidden();

  await page.locator('#ticket-editor-notes').fill('Compra semanal corregida');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect.poll(() => observed.getPatch()).toBeTruthy();
  const patch = observed.getPatch();
  expect(patch.notes).toBe('Compra semanal corregida');
  expect(patch.items).toHaveLength(1);
  expect(patch.items[0]).toMatchObject({
    id: 'receipt_item_milk',
    description: 'Leche entera',
    categoryId: 'category_dairy',
    quantity: 2,
    unit: 'unit',
    unitPriceMinor: 150,
    discount: { type: 'amount', amountMinor: 20, quantity: 1 },
  });
  expect(patch.items[0]).not.toHaveProperty('lineTotalMinor');
  expect(patch).not.toHaveProperty('declaredTotalMinor');
  await expect(page.locator('#ticket-editor-total')).toContainText('2,80');
  await expect(page.locator('#ticket-editor-form-state')).toContainText('sin reescribir la evidencia original');

  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  const deleteDialog = page.locator('#ticket-history-delete-dialog');
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog.locator('#ticket-history-delete-impact')).toContainText('Se eliminarán permanentemente');
  await expect(deleteDialog.locator('#ticket-history-delete-impact')).toContainText('1 captura');
  await expect(deleteDialog.locator('#ticket-history-delete-state')).toContainText('no se puede deshacer');
  await deleteDialog.screenshot({ path: testInfo.outputPath('ticket-delete-warning-mobile.png') });
  const confirmDelete = deleteDialog.getByRole('button', { name: 'Eliminar ticket y datos' });
  await expect(confirmDelete).toBeEnabled();
  await confirmDelete.click();
  await expect(deleteDialog).toBeHidden();
  await expect.poll(() => observed.wasDeleted()).toBe(true);
  await expect(page).toHaveURL(/\/tickets\/history$/);
  await expect(page.locator('#ticket-history-range')).toHaveText('0 resultados');
  await expectNoHorizontalOverflow(page);
  expect(runtimeErrors).toEqual([]);
});

test('ticket history desktop preserves dense list/detail hierarchy without horizontal page overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installRoutes(page);

  await page.goto('/');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
  await page.getByRole('button', { name: 'Historial', exact: true }).click();
  await expect(page.locator('.ticket-history-list-heading')).toBeVisible();
  await expect(page.locator('.ticket-history-row')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.locator('.view[data-view="ticket-history"]').screenshot({ path: testInfo.outputPath('ticket-history-desktop.png') });

  await page.locator('[data-ticket-action="open"][data-ticket-id="ticket_20260902"]').click();
  await expect(page.locator('#ticket-history-detail-screen')).toBeVisible();
  const lineHeading = page.locator('.ticket-line-heading');
  await expect(lineHeading).toBeVisible();
  await expect(page.locator('#ticket-editor-lines-list .ticket-editor-line')).toHaveCount(1);
  const headerWidths = await lineHeading.locator(':scope > span').evaluateAll(elements => elements.slice(2, 4).map(element => ({
    label: element.textContent?.trim() || '',
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  })));
  expect(headerWidths).toEqual([
    expect.objectContaining({ label: 'Cantidad' }),
    expect.objectContaining({ label: 'Unidad' }),
  ]);
  for (const header of headerWidths) expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth);
  await expectNoHorizontalOverflow(page);
  await page.locator('.view[data-view="ticket-history"]').screenshot({ path: testInfo.outputPath('ticket-editor-desktop.png') });
});
