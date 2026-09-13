import { test, expect } from '@playwright/test';

test('offline component gallery exposes shared controls and dialog behavior', async ({ page }) => {
  await page.route('**/api/v1/meta', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: false }) }));
  await page.goto('/components');

  await expect(page.locator('.view[data-view="components"]')).toBeVisible();
  await expect(page.locator('.view[data-view="components"] app-field')).toHaveCount(4);
  await expect(page.locator('.view[data-view="components"] app-button button[disabled]')).toBeDisabled();
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

test('receipt layout keeps measured edge padding and compact action heights', async ({ page }) => {
  await page.goto('/components');
  const metrics = await page.evaluate(async () => {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/receipt-review.css';
    document.head.append(stylesheet);
    await new Promise(resolve => stylesheet.addEventListener('load', resolve, { once: true }));
    const row = document.createElement('div');
    row.className = 'receipt-detected-item';
    document.body.append(row);
    const confirm = document.createElement('button');
    confirm.id = 'confirm-receipt';
    confirm.className = 'button primary';
    const secondary = document.createElement('button');
    secondary.className = 'button secondary';
    const actions = document.createElement('div');
    actions.className = 'receipt-live-summary__actions';
    actions.append(secondary, confirm);
    document.body.append(actions);
    const queue = document.createElement('section');
    queue.className = 'receipt-source-queue';
    const actionRow = document.createElement('div');
    actionRow.className = 'capture-card__action-row';
    for (let index = 0; index < 4; index += 1) actionRow.append(document.createElement('button'));
    queue.append(actionRow);
    document.body.append(queue);
    return {
      rowPaddingLeft: Number.parseFloat(getComputedStyle(row).paddingLeft),
      rowPaddingRight: Number.parseFloat(getComputedStyle(row).paddingRight),
      confirmHeight: Number.parseFloat(getComputedStyle(confirm).minHeight),
      secondaryHeight: Number.parseFloat(getComputedStyle(secondary).minHeight),
      actionPadding: Number.parseFloat(getComputedStyle(actions).paddingLeft),
      actionGap: Number.parseFloat(getComputedStyle(actions).gap),
      queueActionWrap: getComputedStyle(actionRow).flexWrap,
      queueActionTops: [...actionRow.children].map(button => button.getBoundingClientRect().top),
    };
  });
  expect(metrics.rowPaddingLeft).toBeGreaterThanOrEqual(8);
  expect(metrics.rowPaddingRight).toBeGreaterThanOrEqual(8);
  expect(metrics.actionPadding).toBeGreaterThanOrEqual(12);
  expect(metrics.actionGap).toBeGreaterThanOrEqual(8);
  expect(metrics.queueActionWrap).toBe('nowrap');
  expect(new Set(metrics.queueActionTops).size).toBe(1);
  expect(metrics.confirmHeight).toBeGreaterThanOrEqual(40);
  expect(metrics.confirmHeight).toBe(metrics.secondaryHeight);
});

test('receipt category and product pickers use shared paginated dialogs', async ({ page }) => {
  const categories = Array.from({ length: 9 }, (_, index) => ({
    id: `category_${index + 1}`,
    name: `Categoría ${index + 1}`,
    color: index % 2 ? '#007a5e' : '#d97706',
  }));
  await page.route('**/api/v1/categories', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ categories }),
  }));
  await page.route('**/api/v1/catalog?*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      catalog: {
        products: [{ id: 'variant_tea', canonicalName: 'Té verde', variantName: 'Té verde bio', categoryName: 'Infusiones' }],
        parents: [], total: 1, offset: 0, limit: 8, hasMore: false,
      },
    }),
  }));
  await page.goto('/components');

  await page.evaluate(async () => {
    const { openReceiptCategoryPicker } = await import('/receipt-line-pickers.js');
    openReceiptCategoryPicker({ selectedId: '', onSelect: category => { window.__selectedCategory = category.id; } });
  });
  await expect(page.locator('#receipt-category-picker').locator('dialog')).toBeVisible();
  const pickerGeometry = await page.evaluate(() => {
    const host = document.querySelector('#receipt-category-picker');
    const dialog = host?.shadowRoot?.querySelector('dialog');
    const footer = host?.shadowRoot?.querySelector('footer');
    if (!dialog || !footer) return null;
    const dialogBox = dialog.getBoundingClientRect();
    const footerBox = footer.getBoundingClientRect();
    return { dialogBottom: dialogBox.bottom, footerBottom: footerBox.bottom };
  });
  expect(pickerGeometry).not.toBeNull();
  expect(pickerGeometry.footerBottom).toBeLessThanOrEqual(pickerGeometry.dialogBottom + 1);
  await expect(page.getByRole('button', { name: 'Categoría 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Categoría 9' }).click();
  await expect.poll(() => page.evaluate(() => window.__selectedCategory)).toBe('category_9');

  await page.evaluate(async () => {
    const { openReceiptProductPicker } = await import('/receipt-line-pickers.js');
    await openReceiptProductPicker({ description: 'té', onSelect: product => { window.__selectedProduct = product.id; } });
  });
  await expect(page.locator('#receipt-product-picker').locator('dialog')).toBeVisible();
  await page.getByRole('button', { name: /Té verde bio/ }).click();
  await expect.poll(() => page.evaluate(() => window.__selectedProduct)).toBe('variant_tea');
});

test('receipt invoice summary projects price, discount and validation in a shared dialog', async ({ page }) => {
  await page.goto('/components');
  await page.evaluate(async () => {
    const { createReceiptInvoiceLineDialog, enhanceReceiptInvoiceEditor, refreshReceiptInvoiceEditor } = await import('/receipt-editor-invoice.js');
    const dialog = createReceiptInvoiceLineDialog({
      id: 'summary-regression-dialog', titleId: 'summary-regression-title', title: 'Editar línea 1',
      closeId: 'summary-regression-close', slotId: 'summary-regression-slot', actions: [],
    });
    const item = document.createElement('fieldset');
    item.className = 'receipt-item receipt-item--editing';
    item.dataset.receiptLineEditor = 'true';
    item.dataset.editorValidation = 'confirmed';
    item.innerHTML = `
      <legend>Línea</legend>
      <label class="field"><span>Producto</span><input data-field="description" value="PATATA"></label>
      <label class="field receipt-category-field"><span>Categoría</span><select data-field="categoryId"><option>Verduras</option></select></label>
      <div class="quantity-row"><label class="field"><span>Cantidad</span><input data-field="quantity" value="2"></label><label class="field"><span>Precio unitario</span><input data-field="unitPriceEuro" value="2,55"></label></div>
      <div class="quantity-row"><label class="field"><span>Tipo</span><select data-field="discountType"><option value="amount">Importe</option></select></label><output data-field="lineTotalEuro">4,10</output></div>`;
    dialog.querySelector('#summary-regression-slot').append(item);
    document.body.append(dialog);
    enhanceReceiptInvoiceEditor(dialog);
    dialog.showModal();
    refreshReceiptInvoiceEditor(dialog);
  });
  const dialog = page.locator('#summary-regression-dialog');
  await expect(dialog.locator('[data-editor-summary-base]')).toHaveText('5,10 €');
  await expect(dialog.locator('[data-editor-summary-discount]')).toHaveText('-1,00 €');
  await expect(dialog.locator('[data-editor-summary-total]')).toHaveText('4,10 €');
  await expect(dialog.locator('[data-editor-summary-validation]')).toHaveText('Total validado');
});

test('direct PDF status copy never falls back to OCR terminology', async ({ page }) => {
  await page.goto('/components');
  const messages = await page.evaluate(async () => {
    const { pagePartialText, pageStageDescription } = await import('/receipt-capture.js');
    const completed = { directPdf: true, status: 'completed', aiStatus: 'pending' };
    const manual = { directPdf: true, status: 'manual', aiStatus: 'pending', result: { final: { items: [] } } };
    return [
      pageStageDescription(completed),
      pageStageDescription(manual),
      pagePartialText({ directPdf: true, status: 'error', error: '' }),
    ];
  });
  expect(messages.join(' ')).toMatch(/PDF/u);
  expect(messages.join(' ')).not.toMatch(/OCR/u);
});

test('detected-store edit opens the shared source editor for its capture', async ({ page }) => {
  const createdStores = [];
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ configured: false }),
  }));
  await page.route('**/api/v1/inventory/stores?*', route => {
    const query = new URL(route.request().url()).searchParams.get('q') || '';
    const stores = query.toLocaleLowerCase('es-ES').includes('centro')
      ? [{ id: 'store_centro', name: 'Centro' }]
      : [{ id: 'store_vicar', name: 'VÍCAR' }, { id: 'store_centro', name: 'Centro' }];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ stores }) });
  });
  await page.route('**/api/v1/stores', async route => {
    createdStores.push(route.request().postDataJSON());
    await route.fulfill({ json: { store: { id: 'store_new', name: 'Nueva tienda' } } });
  });
  await page.goto('/');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
  await page.evaluate(async () => {
    const { state, captureKey, createPageState } = await import('/receipt-state.js');
    const { applyCaptureDrafts } = await import('/receipt-review.js');
    state.captures = [{
      storageKey: 'capture-source-editor-test', name: 'ticket.pdf', mimeType: 'application/pdf',
      retailerName: 'Consum', storeName: 'VÍCAR', storeId: '',
    }];
    const capture = state.captures[0];
    const page = createPageState();
    page.status = 'completed';
    page.result = { final: {
      items: [{ description: 'Producto', quantity: 1, unitPriceMinor: 100, lineTotalMinor: 100 }],
      declaredTotalMinor: 100, retailerName: 'Consum', storeName: 'VÍCAR', categories: [], warnings: [],
      review: { lines: [], total: { expectedMinor: 100, differenceMinor: 0, valid: true } },
    } };
    state.pageStates.set(captureKey(capture), page);
    state.selectedReviewCaptureKey = 'capture-source-editor-test';
    applyCaptureDrafts();
  });
  await page.getByRole('button', { name: 'Editar tienda detectada' }).click();
  const dialog = page.locator('#receipt-source-editor');
  await expect(dialog.locator('dialog')).toBeVisible();
  await expect(dialog.locator('#receipt-source-retailer')).toHaveValue('Consum');
  await expect(dialog.locator('#receipt-source-editor-title')).toHaveText('Editar archivo');
  await expect(dialog.locator('#receipt-source-editor-file')).toHaveText('ticket.pdf');
  await expect(dialog.locator('.app-dialog-header .eyebrow')).toHaveText('Archivo del ticket');
  await expect(dialog.getByRole('button', { name: 'Cerrar' })).toHaveText('×');
  const actionLayout = await page.evaluate(() => ['receipt-show-evidence', 'validate-receipt-ticket', 'confirm-receipt']
    .map(id => {
      const box = document.getElementById(id)?.getBoundingClientRect();
      return box ? { top: box.top, bottom: box.bottom, height: box.height } : null;
    }));
  expect(actionLayout.every(Boolean)).toBe(true);
  expect(actionLayout[0].bottom).toBeLessThanOrEqual(actionLayout[1].top);
  expect(actionLayout[1].bottom).toBeLessThanOrEqual(actionLayout[2].top);
  expect(actionLayout.map(action => action.height)).toEqual([actionLayout[0].height, actionLayout[0].height, actionLayout[0].height]);
  await dialog.locator('#receipt-source-store-search').fill('Centro');
  await expect(dialog.locator('#receipt-source-store option')).toHaveCount(2);
  await expect(dialog.locator('#receipt-source-store option').nth(1)).toHaveText('Centro');
  await dialog.locator('#receipt-source-store-name').fill('Nueva tienda');
  await dialog.getByRole('button', { name: 'Guardar archivo' }).click();
  await expect.poll(() => createdStores.length).toBe(1);
  expect(createdStores[0]).toEqual({ retailerName: 'Consum', name: 'Nueva tienda' });
  await expect(page.locator('#receipt-store')).toHaveValue('Nueva tienda');
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/receipt-state.js');
    return state.receiptDrafts[0]?.storeName;
  })).toBe('Nueva tienda');
});

test('completed captures become independent receipt drafts with their own store and total', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ configured: false }),
  }));
  await page.route('**/api/v1/categories', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ categories: [] }),
  }));
  await page.goto('/');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
  await page.evaluate(async () => {
    const { state, captureKey, createPageState } = await import('/receipt-state.js');
    const { applyCaptureDrafts } = await import('/receipt-review.js');
    state.captures = [
      { storageKey: 'draft-one', name: 'uno.pdf', mimeType: 'application/pdf', retailerName: 'Mercado Uno', storeName: 'Centro Uno', storeId: 'store_one' },
      { storageKey: 'draft-two', name: 'dos.pdf', mimeType: 'application/pdf', retailerName: 'Mercado Dos', storeName: 'Centro Dos', storeId: 'store_two' },
    ];
    for (const [index, capture] of state.captures.entries()) {
      const page = createPageState();
      page.status = 'completed';
      page.result = { final: {
        items: [{ description: `Producto ${index + 1}`, quantity: 1, unitPriceMinor: (index + 1) * 100, lineTotalMinor: (index + 1) * 100 }],
        declaredTotalMinor: (index + 1) * 100,
        retailerName: capture.retailerName,
        storeName: capture.storeName,
        categories: [], warnings: [], review: { lines: [], total: { expectedMinor: (index + 1) * 100, differenceMinor: 0, valid: true } },
      } };
      state.pageStates.set(captureKey(capture), page);
    }
    applyCaptureDrafts();
    state.retailerCandidates.set('mercado uno', 'Mercado Uno');
    state.retailerCandidates.set('mercado dos', 'Mercado Dos');
    const { renderProgressiveDetectedItems } = await import('/receipt-capture.js');
    renderProgressiveDetectedItems();
    window.__receiptDrafts = state.receiptDrafts.map(draft => ({ key: draft.key, captureKeys: draft.captureKeys }));
  });
  await expect.poll(() => page.evaluate(() => window.__receiptDrafts)).toEqual([
    { key: 'draft-one', captureKeys: ['draft-one'] },
    { key: 'draft-two', captureKeys: ['draft-two'] },
  ]);
  await expect(page.locator('#receipt-draft-selector-field')).toBeVisible();
  await expect(page.locator('#receipt-draft-selector option')).toHaveCount(2);
  await page.locator('#receipt-draft-selector').selectOption('draft-two');
  await expect(page.locator('#receipt-review-capture')).toHaveValue('draft-two');
  await expect(page.locator('#receipt-retailer')).toHaveValue('Mercado Dos');
  await expect(page.locator('#receipt-store')).toHaveValue('Centro Dos');
  await expect(page.locator('#receipt-total')).toHaveValue('2.00');
  await expect(page.locator('#receipt-review')).toContainText('Producto 2');
  await expect(page.locator('#receipt-review')).not.toContainText('Producto 1');
  await expect(page.locator('#receipt-live-retailer-name')).toHaveText('Mercado Dos');
  await page.evaluate(async () => {
    const { showReceiptEvidence } = await import('/receipts.js');
    showReceiptEvidence();
  });
  await expect(page.locator('#receipt-evidence-dialog').locator('dialog')).toBeVisible();
  await expect(page.locator('#receipt-evidence-capture option')).toHaveCount(1);
  await expect(page.locator('#receipt-evidence-capture option')).toHaveText(/dos\.pdf/u);
});

test('a total warning is accepted per receipt draft and imports only that draft evidence', async ({ page }) => {
  const confirmations = [];
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({ json: { configured: false } }));
  await page.route('**/api/v1/categories', route => route.fulfill({ json: { categories: [] } }));
  await page.route('**/api/v1/receipts/validate', async route => route.fulfill({ json: {
    lines: [{ validation: { status: 'confirmed' } }], total: { expectedMinor: 120, differenceMinor: -20, valid: false },
  } }));
  await page.route('**/api/v1/receipts/confirm', async route => {
    confirmations.push(route.request().postDataJSON());
    await route.fulfill({ json: { receipt: { id: 'receipt_one' } } });
  });
  await page.goto('/');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
  await page.evaluate(async () => {
    const { state, captureKey, createPageState } = await import('/receipt-state.js');
    const { applyCaptureDrafts } = await import('/receipt-review.js');
    state.captures = [
      { storageKey: 'confirm-one', name: 'uno.pdf', mimeType: 'application/pdf', retailerName: 'Mercado Uno', storeName: 'Centro Uno', storeId: 'store_one' },
      { storageKey: 'confirm-two', name: 'dos.pdf', mimeType: 'application/pdf', retailerName: 'Mercado Dos', storeName: 'Centro Dos', storeId: 'store_two' },
    ];
    for (const capture of state.captures) {
      const page = createPageState(); page.status = 'completed';
      page.result = { final: { items: [{ description: 'Producto', quantity: 1, unitPriceMinor: 120, lineTotalMinor: 120, productVariantId: 'variant_saved', categoryId: 'category_food' }], declaredTotalMinor: 100, retailerName: capture.retailerName, storeName: capture.storeName, categories: [], warnings: [], review: { lines: [], total: { expectedMinor: 120, differenceMinor: -20, valid: false } } } };
      state.pageStates.set(captureKey(capture), page);
    }
    applyCaptureDrafts();
  });
  await page.locator('#confirm-receipt').click();
  await expect.poll(() => confirmations.length).toBe(0);
  await page.locator('#confirm-receipt').click();
  await expect.poll(() => confirmations.length).toBe(1);
  expect(confirmations[0].captures).toEqual([expect.objectContaining({ storageKey: 'confirm-one' })]);
  expect(confirmations[0].captures).toHaveLength(1);
  expect(confirmations[0].acceptTotalMismatch).toBe(true);
  expect(confirmations[0].items).toEqual([expect.objectContaining({ productVariantId: 'variant_saved', categoryId: 'category_food' })]);
  await expect(page.locator('#receipt-review-capture')).toHaveValue('confirm-two');
  await expect(page.locator('#receipt-retailer')).toHaveValue('Mercado Dos');
});
