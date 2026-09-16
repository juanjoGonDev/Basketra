import { test, expect } from '@playwright/test';

const EXTRACTION = {
  originalText: 'BANANA 1,50',
  final: {
    items: [{
      description: 'BANANA',
      quantity: 1,
      unitPriceMinor: 150,
      lineTotalMinor: 150,
      confidence: 1,
      categoryId: 'category_fruit',
      sourceLines: [1],
    }],
    declaredTotalMinor: 150,
    warnings: [],
    categories: [{ id: 'category_fruit', name: 'Fruta', color: '#32A852' }],
    review: {
      lines: [{ status: 'confirmed', expectedMinor: 150, differenceMinor: 0 }],
      total: { expectedMinor: 150, differenceMinor: 0, valid: true },
    },
  },
};

async function openReviewedTicket(page) {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));
  await page.goto('/tickets');
  // initReceipts() installs and wires the receipt workspace in a single task, so waiting for a field
  // the application creates is the boot barrier that guarantees the listeners under test are bound.
  await expect(page.locator('#receipt-retailer')).toBeAttached();
  await page.evaluate(async extraction => {
    const [{ applyExtraction }, { renderProgressiveDetectedItems }] = await Promise.all([
      import('/receipt-review.js'),
      import('/receipt-capture.js'),
    ]);
    applyExtraction(extraction);
    renderProgressiveDetectedItems();
  }, EXTRACTION);
  await expect(page.locator('#receipt-review .receipt-item')).toHaveCount(1);
  await expect(page.locator('#receipt-detected-list .receipt-detected-item')).toHaveCount(1);
}

test('the line editor rejects an empty description and a validation without a session', async ({ page }) => {
  await openReviewedTicket(page);

  await page.locator('#receipt-detected-list .receipt-detected-item').first().click();
  const dialog = page.locator('#receipt-line-dialog');
  await expect(dialog).toBeVisible();
  const description = dialog.locator('[data-field="description"]');
  await expect(description).toHaveValue('BANANA');

  await description.evaluate(element => { element.value = ''; });
  await dialog.getByRole('button', { name: 'Validar línea', exact: true }).click();

  await expect(dialog.locator('#receipt-line-editor-state')).toHaveText('Indica el producto antes de validar esta línea.');
  await expect(description).toHaveAttribute('aria-invalid', 'true');
  await expect(description).toBeFocused();
  await expect(page.locator('#receipt-line-editor-slot .receipt-item')).toHaveCount(1);

  // Cancelling restores the line and drops the session: the same click must stop at the guard.
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.locator('#receipt-line-editor-slot .receipt-item')).toHaveCount(0);
  await expect(page.locator('#receipt-review .receipt-item')).toHaveCount(1);
  await page.evaluate(() => document.querySelector('#validate-receipt-line-editor').click());
  await expect(page.locator('#receipt-line-editor-state')).toHaveText('Indica el producto antes de validar esta línea.');
  await expect(page.locator('#receipt-line-editor-slot .receipt-item')).toHaveCount(0);
});

test('the line editor falls back to the first line and to the trigger without a detected row', async ({ page }) => {
  await openReviewedTicket(page);

  await page.evaluate(() => {
    // No detected row can match the return-focus selector and the line carries no index.
    document.querySelector('#receipt-detected-list').replaceChildren();
    const item = document.querySelector('#receipt-review .receipt-item');
    delete item.dataset.itemIndex;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.dataset.receiptEditor = 'true';
    trigger.textContent = 'Editar línea';
    item.append(trigger);
    trigger.click();
  });

  await expect(page.locator('#receipt-line-dialog-title')).toHaveText('Editar línea 1');
  await expect(page.locator('#receipt-line-editor-slot .receipt-item')).toHaveCount(1);

  await page.evaluate(() => document.querySelector('#cancel-receipt-line-editor').click());

  await expect(page.locator('#receipt-line-editor-slot .receipt-item')).toHaveCount(0);
  await expect(page.locator('#receipt-review .receipt-item')).toHaveCount(1);
  await expect(page.locator('#receipt-review .receipt-item--editing')).toHaveCount(0);
});

test('a category change in the review refreshes the compact line summary', async ({ page }) => {
  await openReviewedTicket(page);

  const changeCategory = value => page.evaluate(async nextValue => {
    const review = document.querySelector('#receipt-review');
    const select = review.querySelector('.receipt-item [data-field="categoryId"]');
    select.value = nextValue;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const summary = review.querySelector('.receipt-item .receipt-line-compact');
    const category = summary.querySelector('[data-receipt-summary-category]');
    return {
      label: category.querySelector('[data-receipt-summary-category-label]').textContent,
      hidden: category.hidden,
      swatch: category.querySelector('[data-receipt-summary-category-swatch]').style.backgroundColor,
      accessibleLabel: summary.getAttribute('aria-label'),
    };
  }, value);

  const cleared = await changeCategory('');
  expect(cleared.label).toBe('');
  expect(cleared.hidden).toBe(true);
  expect(cleared.swatch).toContain('var(--color-primary)');
  expect(cleared.accessibleLabel).toBe('Editar línea 1: BANANA');

  const assigned = await changeCategory('category_fruit');
  expect(assigned.label).toBe('Fruta');
  expect(assigned.hidden).toBe(false);
  expect(assigned.swatch.toLowerCase()).toMatch(/rgb\(50, 168, 82\)|#32a852/u);
  expect(assigned.accessibleLabel).toBe('Editar línea 1: BANANA. Categoría: Fruta');

  // A category control outside a line and a non-category field leave every summary untouched.
  const ignored = await page.evaluate(async () => {
    const review = document.querySelector('#receipt-review');
    const orphan = document.createElement('select');
    orphan.dataset.field = 'categoryId';
    review.append(orphan);
    orphan.dispatchEvent(new Event('change', { bubbles: true }));
    review.querySelector('.receipt-item [data-field="quantity"]').dispatchEvent(new Event('change', { bubbles: true }));
    return review.querySelector('[data-receipt-summary-category-label]').textContent;
  });
  expect(ignored).toBe('Fruta');
});

test('receipt evidence falls back safely without captures, content or a previous selection', async ({ page }) => {
  await openReviewedTicket(page);

  const reads = await page.evaluate(async () => {
    const [{ state }, receipts] = await Promise.all([import('/receipt-state.js'), import('/receipts.js')]);
    const output = {};

    // Without captures the selector falls back to an empty key, the content stays empty and the
    // evidence dialog does not open.
    state.captures = [];
    receipts.renderReceiptEvidence();
    output.emptySelectorValue = document.querySelector('#receipt-evidence-capture').value;
    output.emptyContent = document.querySelector('#receipt-evidence-content').children.length;
    receipts.showReceiptEvidence();
    output.emptyDialogOpen = document.querySelector('#receipt-evidence-dialog').hasAttribute('open');

    // With captures the previous selection survives a re-render and a PDF keeps its document view.
    state.captures = [
      { name: 'ticket-a.png', mimeType: 'image/png', storageKey: 'key_a', size: 10 },
      { name: 'ticket-b.pdf', mimeType: 'application/pdf', storageKey: 'key_b', size: 20 },
    ];
    receipts.renderReceiptEvidence();
    output.optionCount = document.querySelector('#receipt-evidence-capture').options.length;
    document.querySelector('#receipt-evidence-capture').value = 'key_b';
    receipts.renderReceiptEvidence();
    output.restoredValue = document.querySelector('#receipt-evidence-capture').value;
    output.pdfTitle = document.querySelector('#receipt-evidence-content iframe')?.title ?? '';

    // A missing content container stops the render instead of throwing.
    document.querySelector('#receipt-evidence-content').remove();
    receipts.renderReceiptEvidence();
    output.contentStillMissing = document.querySelector('#receipt-evidence-content') === null;
    return output;
  });

  expect(reads).toEqual({
    emptySelectorValue: '',
    emptyContent: 0,
    emptyDialogOpen: false,
    optionCount: 2,
    restoredValue: 'key_b',
    pdfTitle: 'Comprobante PDF: ticket-b.pdf',
    contentStillMissing: true,
  });
});

test('the sticky summary only returns when the compact actions are gone', async ({ page }) => {
  await openReviewedTicket(page);

  const reads = await page.evaluate(async () => {
    const [{ state }, receipts] = await Promise.all([import('/receipt-state.js'), import('/receipts.js')]);
    const sticky = document.querySelector('#receipt-review-sticky-summary');
    const output = {
      actionsBefore: document.querySelectorAll('#receipt-live-summary-actions').length,
      confirmParentBefore: document.querySelector('#confirm-receipt')?.parentElement?.id ?? '',
    };

    // The compact summary owns the confirm button and keeps the legacy sticky hidden.
    state.items = [];
    receipts.syncStickyReviewSummary();
    output.hiddenWithActions = sticky.hidden;

    // The legacy branch needs the confirm button in the document, so move it out before removing the
    // compact actions that adopted it.
    document.querySelector('#receipt-review-panel').append(document.querySelector('#confirm-receipt'));
    document.querySelector('#receipt-live-summary-actions').remove();
    output.actionsAfter = document.querySelectorAll('#receipt-live-summary-actions').length;
    receipts.syncStickyReviewSummary();
    output.hiddenWithoutActions = sticky.hidden;
    output.summaryMeta = document.querySelector('#receipt-review-summary-meta')?.textContent ?? '';
    output.stickyChildren = [...sticky.children].length;
    return output;
  });

  expect(reads).toEqual({
    actionsBefore: 1,
    confirmParentBefore: expect.any(String),
    hiddenWithActions: true,
    actionsAfter: 0,
    hiddenWithoutActions: false,
    summaryMeta: expect.any(String),
    stickyChildren: expect.any(Number),
  });
  expect(reads.stickyChildren).toBeGreaterThan(1);
});

test('receipt review events stop at their guards before touching the ticket', async ({ page }) => {
  await openReviewedTicket(page);

  const guarded = await page.evaluate(async () => {
    const { state } = await import('/receipt-state.js');
    const review = document.querySelector('#receipt-review');
    const list = document.querySelector('#receipt-detected-list');
    const output = {};

    // An out-of-range line index never starts a validation.
    review.dispatchEvent(new CustomEvent('basketra:receipt-validate-line', { bubbles: true, detail: { index: 99 } }));
    output.busyAfterInvalidValidation = review.querySelectorAll('[aria-busy="true"]').length;

    // Keys that do not activate, and activation keys without an edit action, are ignored.
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    list.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    list.querySelector('[data-receipt-action="edit"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    output.editorOpenAfterIgnoredKeys = document.querySelector('#receipt-line-editor-slot').children.length > 0;

    // A source capture that is not a draft only records the review reference.
    const sourceSelect = document.querySelector('#receipt-review-capture');
    sourceSelect.append(new Option('Fuera de revisión', 'missing-capture'));
    sourceSelect.value = 'missing-capture';
    sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    output.selectedReviewCaptureKey = state.selectedReviewCaptureKey;

    // A source-changed event without a capture key resolves to an empty key.
    document.dispatchEvent(new CustomEvent('basketra:receipt-capture-source-changed', { detail: {} }));
    document.dispatchEvent(new CustomEvent('basketra:receipt-capture-source-changed'));
    output.keyAfterEmptySourceChange = state.selectedReviewCaptureKey;

    // The evidence event accepts a key, an empty key, a non-string key and no detail at all.
    document.dispatchEvent(new CustomEvent('basketra:show-receipt-evidence', { detail: { captureKey: 'key_a' } }));
    output.keyAfterEvidenceEvent = state.selectedReviewCaptureKey;
    document.dispatchEvent(new CustomEvent('basketra:show-receipt-evidence', { detail: { captureKey: '' } }));
    document.dispatchEvent(new CustomEvent('basketra:show-receipt-evidence', { detail: { captureKey: 42 } }));
    document.dispatchEvent(new CustomEvent('basketra:show-receipt-evidence'));
    output.keyAfterInvalidEvidenceEvents = state.selectedReviewCaptureKey;
    output.evidenceDialogOpen = document.querySelector('#receipt-evidence-dialog').hasAttribute('open');
    return output;
  });

  expect(guarded.busyAfterInvalidValidation).toBe(0);
  expect(guarded.editorOpenAfterIgnoredKeys).toBe(false);
  expect(guarded.selectedReviewCaptureKey).toBe('missing-capture');
  expect(guarded.keyAfterEmptySourceChange).toBe('missing-capture');
  expect(guarded.keyAfterEvidenceEvent).toBe('key_a');
  expect(guarded.keyAfterInvalidEvidenceEvents).toBe('key_a');
  expect(guarded.evidenceDialogOpen).toBe(false);

  // Space on the detected row is the accessible activation path and still opens the line editor.
  await page.evaluate(() => {
    document.querySelector('#receipt-detected-list [data-receipt-action="edit"]')
      .dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  });
  await expect(page.locator('#receipt-line-editor-slot [data-field="description"]')).toHaveValue('BANANA');
});
