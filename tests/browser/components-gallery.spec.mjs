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
    const actions = document.createElement('div');
    actions.className = 'receipt-live-summary__actions';
    actions.append(confirm);
    document.body.append(actions);
    return {
      rowPaddingLeft: Number.parseFloat(getComputedStyle(row).paddingLeft),
      rowPaddingRight: Number.parseFloat(getComputedStyle(row).paddingRight),
      confirmHeight: Number.parseFloat(getComputedStyle(confirm).minHeight),
      actionPadding: Number.parseFloat(getComputedStyle(actions).paddingLeft),
    };
  });
  expect(metrics.rowPaddingLeft).toBeGreaterThanOrEqual(8);
  expect(metrics.rowPaddingRight).toBeGreaterThanOrEqual(8);
  expect(metrics.actionPadding).toBeGreaterThanOrEqual(8);
  expect(metrics.confirmHeight).toBeGreaterThanOrEqual(40);
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
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ configured: false }),
  }));
  await page.route('**/api/v1/inventory/stores?*', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ stores: [] }),
  }));
  await page.goto('/');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
  await page.evaluate(async () => {
    const { state } = await import('/receipt-state.js');
    state.captures = [{
      storageKey: 'capture-source-editor-test', name: 'ticket.pdf', mimeType: 'application/pdf',
      retailerName: 'Consum', storeName: 'VÍCAR', storeId: '',
    }];
    state.selectedReviewCaptureKey = 'capture-source-editor-test';
  });
  await page.getByRole('button', { name: 'Editar tienda detectada' }).click();
  const dialog = page.locator('#receipt-source-editor');
  await expect(dialog.locator('dialog')).toBeVisible();
  await expect(dialog.locator('#receipt-source-retailer')).toHaveValue('Consum');
  await expect(dialog.locator('#receipt-source-editor-title')).toHaveText('ticket.pdf');
});
