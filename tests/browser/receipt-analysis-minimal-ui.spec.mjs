import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

function ocrEvidence(description = 'PAN INTEGRAL', lineTotalMinor = 165) {
  return {
    text: `${description} 1,65`,
    confidence: 0.92,
    source: 'local-tesseract',
    deterministic: {
      metadata: {},
      items: [{
        description,
        quantity: 1,
        unitPriceMinor: lineTotalMinor,
        lineTotalMinor,
        confidence: 0.92,
        sourceLines: [1],
      }],
    },
  };
}

function completedExtraction(description = 'PAN INTEGRAL', lineTotalMinor = 165) {
  const item = {
    description,
    quantity: 1,
    unitPriceMinor: lineTotalMinor,
    lineTotalMinor,
    confidence: 0.92,
    sourceLines: [1],
  };
  return {
    pages: [{
      position: 0,
      source: 'local-tesseract',
      text: `${description} 1,65`,
      confidence: 0.92,
    }],
    originalText: `${description} 1,65`,
    deterministic: {
      items: [item],
      declaredTotalMinor: lineTotalMinor,
    },
    final: {
      items: [item],
      declaredTotalMinor: lineTotalMinor,
      warnings: [],
      review: {
        lines: [{
          ...item,
          status: 'confirmed',
          expectedMinor: lineTotalMinor,
          differenceMinor: 0,
        }],
        total: {
          expectedMinor: lineTotalMinor,
          differenceMinor: 0,
          valid: true,
        },
      },
    },
  };
}

test('receipt analysis is minimal, responsive and exposes one three-path floating add action', async ({ page }, testInfo) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  for (const viewport of [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1280, height: 900 },
    { width: 1600, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await navigate(page, 'Tickets');

    await expect(page.getByRole('heading', { name: 'Análisis de ticket', exact: true })).toBeVisible();
    await expect(page.locator('.receipt-analysis-header > div:first-child > p:not(.eyebrow)')).toHaveCount(0);
    await expect(page.getByText('Añade un ticket con +. Los productos aparecerán aquí a medida que se detecten.', { exact: true })).toHaveCount(0);
    await expect(page.locator('#receipt-detected-empty')).toBeVisible();
    await expect(page.locator('.receipt-empty-ticket')).toBeVisible();
    await expect(page.locator('#receipt-live-summary')).toBeHidden();
    await expect(page.locator('#receipt-live-retailer-name')).toHaveText('Sin identificar');

    if (viewport.width === 390 || viewport.width === 1280) {
      await page.screenshot({
        path: testInfo.outputPath(`receipt-empty-responsive-${viewport.width}.png`),
        fullPage: true,
      });
    }

    const queue = page.locator('#receipt-source-queue');
    await expect(queue).toBeVisible();
    await expect(queue).not.toHaveAttribute('open', '');
    await expect(queue.locator(':scope > summary')).toHaveAttribute('aria-label', 'Archivos del análisis: 0 archivos');
    await expect(page.locator('#receipt-source-queue-summary')).toHaveText('0');

    const add = page.getByRole('button', { name: 'Añadir al ticket', exact: true });
    await expect(add).toBeVisible();
    await add.click();

    const dial = page.locator('#receipt-add-menu');
    await expect(dial).toBeVisible();
    await expect(dial.getByText('IA', { exact: true })).toBeVisible();
    await expect(dial.getByText('Manual', { exact: true })).toBeVisible();
    await expect(dial.getByText('Scan', { exact: true })).toBeVisible();
    await expect(page.locator('#receipt-analysis-options')).toHaveCount(0);
    await expect(page.locator('#verify-receipt-ai')).toHaveCount(0);

    if (viewport.width >= 1280) {
      const edge = await page.evaluate(() => {
        const trigger = document.querySelector('#receipt-add-trigger').getBoundingClientRect();
        const queueTrigger = document.querySelector('#receipt-source-queue > summary').getBoundingClientRect();
        const menu = document.querySelector('#receipt-add-menu').getBoundingClientRect();
        return {
          trigger: window.innerWidth - trigger.right,
          queue: window.innerWidth - queueTrigger.right,
          menu: window.innerWidth - menu.right,
          triggerSize: trigger.width,
          queueSize: queueTrigger.width,
        };
      });
      expect(edge.trigger).toBeLessThanOrEqual(32.5);
      expect(edge.queue).toBeLessThanOrEqual(32.5);
      expect(edge.menu).toBeLessThanOrEqual(32.5);
      expect(Math.abs(edge.trigger - edge.menu)).toBeLessThanOrEqual(.5);
      expect(Math.abs(edge.trigger - edge.queue)).toBeLessThanOrEqual(.5);
      expect(edge.triggerSize).toBeGreaterThanOrEqual(44);
      expect(edge.queueSize).toBeGreaterThanOrEqual(44);
    }

    if (viewport.width === 390 || viewport.width === 1280 || viewport.width === 1600) {
      await page.screenshot({
        path: testInfo.outputPath(`receipt-add-menu-${viewport.width}.png`),
        fullPage: true,
      });
    }

    await page.keyboard.press('Escape');
    await expect(dial).toBeHidden();

    await queue.locator(':scope > summary').click();
    await expect(queue).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(queue).not.toHaveAttribute('open', '');
    await expect(page.locator('#receipt-state')).not.toContainText('Análisis cancelado');

    if (viewport.width === 390) {
      await add.click();
      await expect(dial).toBeVisible();
      await navigate(page, 'Inicio');
      await navigate(page, 'Tickets');
      await expect(dial).toBeHidden();
    }

    await expectNoHorizontalOverflow(page);
  }
});

test('durable OCR evidence appears progressively in the body while source details stay in the queue', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  await page.route('**/api/v1/ai/runtime-capabilities', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      attachments: {
        maxImageBytes: 20 * 1024 * 1024,
        maxFileBytes: 512 * 1024 * 1024,
      },
    }),
  }));

  const jobId = 'receiptextractionjob_minimalui';
  const progress = {
    pages: [{
      position: 0,
      stage: 'ai',
      ocr: ocrEvidence(),
    }],
  };

  await page.route('**/api/v1/receipts/extraction-jobs', route => route.fulfill({
    status: 202,
    contentType: 'application/json',
    body: JSON.stringify({
      job: {
        id: jobId,
        status: 'running',
        progress,
      },
    }),
  }));
  await page.route(`**/api/v1/receipts/extraction-jobs/${jobId}`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: {
        id: jobId,
        status: 'running',
        progress,
      },
    }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-files').setInputFiles({
    name: 'ticket-progress.png',
    mimeType: 'image/png',
    buffer: validPng,
  });

  await expect(page.locator('#receipt-detected-list')).toContainText('PAN INTEGRAL');
  await expect(page.locator('#receipt-detected-count')).toContainText('1');
  await expect(page.locator('#receipt-live-summary')).toBeVisible();
  await expect(page.locator('#receipt-summary-products')).toHaveText('1');
  await expect(page.locator('#receipt-live-total')).toContainText('1,65');
  await expect(page.locator('#receipt-summary-total')).toContainText('1,65');
  await expect(page.locator('#receipt-detected-list [data-swipe-toggle]')).toHaveCount(0);

  const queue = page.locator('#receipt-source-queue');
  await expect(queue).toHaveAttribute('data-state', 'working');
  await expect(queue.locator(':scope > summary')).toHaveAttribute('aria-label', /1 archivo · 1 procesando/);
  await expect(page.locator('#receipt-source-queue-summary')).toHaveText('1');
  await expect(page.locator('#receipt-progress')).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath('receipt-progressive-collapsed-390.png'),
    fullPage: true,
  });

  await queue.locator(':scope > summary').click();
  await expect(queue).toHaveAttribute('open', '');
  await expect(page.locator('#receipt-progress')).toBeVisible();
  await expect(queue.locator('.capture-card')).toHaveCount(1);
  await expect(queue.locator('.capture-card .status-pill')).toContainText('Verificando con IA');
  await page.screenshot({
    path: testInfo.outputPath('receipt-progressive-queue-390.png'),
    fullPage: true,
  });

  await expect(page.locator('#receipt-review-panel')).toBeHidden();
  await expectNoHorizontalOverflow(page);
});

test('approved mobile and desktop summary keeps products independent while showing retailer total and discounts', async ({ page }, testInfo) => {
  const extraction = {
    pages: [],
    originalText: 'CONSUM',
    final: {
      retailerName: 'Consum',
      declaredTotalMinor: 345,
      categories: [],
      items: [
        {
          description: 'PATATA SELECCION',
          quantity: 1,
          unitPriceMinor: 255,
          lineTotalMinor: 255,
          confidence: 0.98,
          sourceLines: [1],
        },
        {
          description: 'NACHOS CONSUM 150 G',
          quantity: 2,
          unitPriceMinor: 90,
          lineTotalMinor: 90,
          confidence: 0.96,
          sourceLines: [2],
          discount: { type: 'amount', amountMinor: 90, quantity: 1 },
        },
      ],
      unassignedDiscounts: [
        {
          description: 'Descuento tarjeta Consum',
          discount: { type: 'amount', amountMinor: 142 },
          reason: 'Ticket-level promotion',
        },
      ],
      review: {
        lines: [
          { status: 'confirmed', expectedMinor: 255, differenceMinor: 0 },
          { status: 'confirmed', expectedMinor: 90, differenceMinor: 0 },
        ],
        total: { expectedMinor: 345, differenceMinor: 0, valid: true },
      },
    },
  };

  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await navigate(page, 'Tickets');
    await page.evaluate(async payload => {
      const { applyExtraction } = await import('/receipt-review.js');
      applyExtraction(payload);
    }, extraction);

    await expect(page.locator('#receipt-live-retailer-name')).toHaveText('Consum');
    await expect(page.locator('#receipt-detected-list .receipt-detected-item')).toHaveCount(2);
    await expect(page.locator('#receipt-detected-list')).toContainText('PATATA SELECCION');
    await expect(page.locator('#receipt-detected-list')).toContainText('NACHOS CONSUM 150 G');
    await expect(page.locator('.receipt-detected-item--discounted')).toContainText('Descuento detectado');
    await expect(page.locator('#receipt-live-summary')).toBeVisible();
    await expect(page.locator('#receipt-summary-products')).toHaveText('2');
    await expect(page.locator('#receipt-summary-discounts')).toHaveText('2');
    await expect(page.locator('#receipt-summary-discounts-list')).toContainText('Descuento tarjeta Consum');
    await expect(page.locator('#receipt-summary-total')).toContainText('3,45');
    await expect(page.locator('#receipt-detected-list [data-swipe-toggle]')).toHaveCount(2);

    const firstRow = page.locator('#receipt-detected-list .receipt-detected-row').first();
    if (viewport.width === 390) {
      const box = await firstRow.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box.x + box.width * .55, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * .25, box.y + box.height / 2, { steps: 6 });
      await page.mouse.up();
      await expect(firstRow).toHaveAttribute('data-swipe-open', 'true');
    } else {
      await firstRow.getByRole('button', { name: 'Mostrar acciones del producto 1', exact: true }).click();
      await expect(firstRow).toHaveAttribute('data-swipe-open', 'true');
    }

    await firstRow.getByRole('button', { name: 'Editar producto 1', exact: true }).click();
    const editor = page.locator('#receipt-line-dialog');
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('heading', { name: 'Editar línea 1', exact: true })).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Eliminar', exact: true })).toBeVisible();
    await editor.locator('[data-field="description"]').fill('PATATA EDITADA');
    await editor.locator('[data-field="unitPriceEuro"]').fill('3.05');
    await expect(editor.locator('[data-field="lineTotalEuro"]')).toHaveText('3.05');
    await page.screenshot({
      path: testInfo.outputPath(`receipt-detected-editor-${viewport.width}.png`),
      fullPage: true,
    });
    await editor.getByRole('button', { name: 'Guardar línea', exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(page.locator('#receipt-detected-list')).toContainText('PATATA EDITADA');
    await expect(page.locator('#receipt-summary-total')).toContainText('3,95');

    const secondRow = page.locator('#receipt-detected-list .receipt-detected-row').nth(1);
    await secondRow.getByRole('button', { name: 'Mostrar acciones del producto 2', exact: true }).click();
    await secondRow.getByRole('button', { name: 'Eliminar producto 2', exact: true }).click();
    await expect(page.locator('#receipt-detected-list .receipt-detected-item')).toHaveCount(1);
    await expect(page.locator('#receipt-summary-products')).toHaveText('1');
    await expect(page.locator('#receipt-summary-total')).toContainText('3,05');

    if (viewport.width === 390) {
      await expect(page.locator('.receipt-live-total-card')).toBeHidden();
      const positions = await page.evaluate(() => {
        const products = document.querySelector('#receipt-detected-stream').getBoundingClientRect();
        const summary = document.querySelector('#receipt-live-summary').getBoundingClientRect();
        return { productsBottom: products.bottom, summaryTop: summary.top };
      });
      expect(positions.summaryTop).toBeGreaterThanOrEqual(positions.productsBottom);
    } else {
      await expect(page.locator('.receipt-live-total-card')).toBeVisible();
      await expect(page.locator('#receipt-live-total')).toContainText('3,45');
      const positions = await page.evaluate(() => {
        const products = document.querySelector('#receipt-detected-stream').getBoundingClientRect();
        const summary = document.querySelector('#receipt-live-summary').getBoundingClientRect();
        return { productsLeft: products.left, productsRight: products.right, summaryLeft: summary.left };
      });
      expect(positions.summaryLeft).toBeGreaterThan(positions.productsRight);
    }

    await page.screenshot({
      path: testInfo.outputPath(`receipt-approved-summary-${viewport.width}.png`),
      fullPage: true,
    });
    await expectNoHorizontalOverflow(page);
  }
});

test('queue cancel-all preserves uploaded captures and marks active work cancelled', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  let releaseOcr = () => {};
  const gate = new Promise(resolve => { releaseOcr = resolve; });
  await page.route('**/api/v1/receipts/extract', async route => {
    await gate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: completedExtraction() }),
    }).catch(() => {});
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-files').setInputFiles({
    name: 'cancel-me.png',
    mimeType: 'image/png',
    buffer: validPng,
  });

  const queue = page.locator('#receipt-source-queue');
  await queue.locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Cancelar todo el análisis', exact: true }).click();
  releaseOcr();

  await expect(page.locator('.capture-card')).toHaveCount(1);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');
  await expect(page.locator('#receipt-review')).toBeHidden();
  await expect(page.locator('#receipt-state')).toContainText('se conservan');
  await expectNoHorizontalOverflow(page);
});

test('manual floating action uses a cancellable modal without fake capture preview', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  const add = page.getByRole('button', { name: 'Añadir al ticket', exact: true });
  await add.click();
  await page.locator('#receipt-add-manual').click();

  const reviewPanel = page.locator('#receipt-review-panel');
  const dialog = page.locator('#receipt-line-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Añadir producto', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Eliminar', exact: true })).toBeHidden();
  await expect(dialog.locator('[data-field="description"]')).toBeFocused();
  await expect(reviewPanel).not.toHaveAttribute('open', '');
  await expect(page.locator('.receipt-review-evidence')).toBeHidden();
  await expect(page.locator('#receipt-review-panel-title')).toHaveText('Revisión y validación');
  await expect(page.locator('#receipt-add-menu')).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath('receipt-manual-modal-390.png'),
    fullPage: true,
  });

  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.receipt-item')).toHaveCount(0);
  await expect(reviewPanel).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath('receipt-manual-cancelled-390.png'),
    fullPage: true,
  });

  await add.click();
  await page.locator('#receipt-add-manual').click();
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-field="description"]').fill('PAN MANUAL');
  await dialog.getByRole('button', { name: 'Guardar línea', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#receipt-detected-list')).toContainText('PAN MANUAL');
  await expect(reviewPanel).toBeVisible();
  await expect(reviewPanel).not.toHaveAttribute('open', '');
  await expect(page.locator('.receipt-review-evidence')).toBeHidden();
  await expectNoHorizontalOverflow(page);
});


test('receipt minimal UI guards remain fail-closed without leaving transient state behind', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');

  const review = page.locator('#receipt-review');
  await review.evaluate(element => {
    element.dispatchEvent(new CustomEvent('basketra:receipt-edit-line', {
      bubbles: true,
      detail: { index: 'invalid' },
    }));
    element.dispatchEvent(new CustomEvent('basketra:receipt-edit-line', {
      bubbles: true,
      detail: { index: 999 },
    }));
  });
  await expect(page.locator('#receipt-line-dialog')).toBeHidden();

  const add = page.getByRole('button', { name: 'Añadir al ticket', exact: true });
  const aiAction = page.locator('[data-receipt-capture-mode="ai"]');
  await add.click();
  await aiAction.evaluate(element => {
    element.addEventListener('click', event => event.preventDefault(), { capture: true, once: true });
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#receipt-state')).toContainText('No hay proveedor de IA configurado');
  await expect(page.locator('#receipt-add-menu')).toBeHidden();

  await page.evaluate(async () => {
    const { state } = await import('/receipt-state.js');
    const action = document.querySelector('[data-receipt-capture-mode="ai"]');
    const receiptState = document.querySelector('#receipt-state');
    state.aiConfigured = true;
    receiptState.textContent = '';
    document.querySelector('#receipt-add-trigger').click();
    action.addEventListener('click', event => event.preventDefault(), { capture: true, once: true });
    action.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    state.aiConfigured = false;
  });
  await expect(page.locator('#receipt-state')).toHaveText('');
  await expect(page.locator('#receipt-add-menu')).toBeHidden();

  const queue = page.locator('#receipt-source-queue');
  await queue.evaluate(element => { element.open = true; });
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('basketra:view-changed', { detail: { view: 'scan' } }));
  });
  await expect(queue).toHaveAttribute('open', '');
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('basketra:view-changed'));
  });
  await expect(queue).not.toHaveAttribute('open', '');

  await page.evaluate(() => {
    const trigger = document.querySelector('#receipt-add-trigger');
    const parent = trigger.parentNode;
    const next = trigger.nextSibling;
    trigger.remove();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    parent.insertBefore(trigger, next);
  });
  await expect(add).toBeVisible();

  await review.evaluate(element => {
    element.dispatchEvent(new CustomEvent('basketra:receipt-cancel-new-line', {
      bubbles: true,
      detail: { index: 'invalid' },
    }));
  });

  await page.evaluate(() => {
    const reviewElement = document.querySelector('#receipt-review');
    const invalid = document.createElement('fieldset');
    invalid.className = 'receipt-item';
    invalid.dataset.itemIndex = '0';
    reviewElement.append(invalid);
    reviewElement.dispatchEvent(new CustomEvent('basketra:receipt-line-saved', { bubbles: true }));
    invalid.remove();
  });

  await page.evaluate(async () => {
    const receiptState = document.querySelector('#receipt-state');
    const parent = receiptState.parentNode;
    const next = receiptState.nextSibling;
    receiptState.remove();
    const { installReceiptEnhancements } = await import('/receipts.js');
    installReceiptEnhancements();
    parent.insertBefore(receiptState, next);
  });
  await expect(page.locator('#receipt-state')).toBeAttached();

  await page.evaluate(async () => {
    const reviewElement = document.querySelector('#receipt-review');
    reviewElement.hidden = false;
    reviewElement.innerHTML = '<div class="review-total"></div><div class="review-summary"><span class="status-pill"></span></div>';
    const { syncStickyReviewSummary } = await import('/receipts.js');
    syncStickyReviewSummary();
    reviewElement.replaceChildren();
    syncStickyReviewSummary();
  });
  await expect(page.locator('#receipt-review-summary-meta')).toHaveText('');
});
