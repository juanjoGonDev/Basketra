import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

function item(description = 'PAN', lineTotalMinor = 150) {
  return {
    description,
    quantity: 1,
    unitPriceMinor: lineTotalMinor,
    lineTotalMinor,
    confidence: 0.9,
    sourceLines: [1],
  };
}

function extraction(text = 'PAN 1,50\nTOTAL 1,50', options = {}) {
  const items = options.items ?? [item()];
  const declaredTotalMinor = items.reduce((sum, entry) => sum + entry.lineTotalMinor, 0);
  return {
    pages: [{
      position: 0,
      source: options.verified ? 'embedded-text' : 'local-tesseract',
      text,
      confidence: 0.9,
    }],
    originalText: text,
    deterministic: { items, declaredTotalMinor },
    ...(options.verified ? {
      ai: {
        interpretation: {
          currency: 'EUR',
          correctedText: text,
          items,
          warnings: [],
        },
        attempts: 1,
        pages: [],
      },
    } : {}),
    final: {
      items,
      declaredTotalMinor,
      warnings: [],
      review: {
        lines: items.map(entry => ({
          ...entry,
          status: 'confirmed',
          expectedMinor: entry.lineTotalMinor,
          differenceMinor: 0,
        })),
        total: { expectedMinor: declaredTotalMinor, differenceMinor: 0, valid: true },
      },
    },
  };
}

async function upload(page, names) {
  await page.locator('#receipt-files').setInputFiles(names.map((name, index) => ({
    name,
    mimeType: 'image/png',
    buffer: Buffer.concat([validPng, Buffer.from([80 + index])]),
  })));
}

test('receipt upload starts the two-slot OCR pool without exposing a second processing step', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  let startedOcr = 0;
  let releaseOcr = () => {};
  const ocrGate = new Promise(resolve => { releaseOcr = resolve; });
  await page.route('**/api/v1/receipts/extract', async route => {
    const body = route.request().postDataJSON();
    const isSingleOcr = body.verifyWithAi === false
      && body.captures?.length === 1
      && !body.captures[0].embeddedText;
    if (isSingleOcr) {
      startedOcr += 1;
      await ocrGate;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: extraction() }),
    }).catch(() => {});
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.evaluate(async () => {
    const { installReceiptEnhancements } = await import('/receipts.js');
    installReceiptEnhancements();
  });

  await expect(page.getByText('Paso 1', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Paso 2', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Leer con OCR local', exact: true })).toHaveCount(0);
  await expect(page.locator('#receipt-analysis-options')).not.toHaveAttribute('open', '');

  await upload(page, ['auto-1.png', 'auto-2.png', 'auto-3.png']);

  await expect.poll(() => startedOcr).toBe(2);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'OCR local' })).toHaveCount(2);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Pendiente' })).toHaveCount(1);
  await expect(page.locator('#receipt-progress-detail')).toContainText('2 procesando');
  await expect(page.locator('#receipt-progress-detail')).toContainText('1 pendientes');

  releaseOcr();
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Completada' })).toHaveCount(3);
  await expect(page.locator('#receipt-progress')).toBeHidden();
  await expect(page.locator('#receipt-review-panel')).toHaveAttribute('open', '');
  const compactLine = page.locator('.receipt-line-compact').first();
  await compactLine.click();
  const editor = page.locator('#receipt-line-dialog');
  await expect(editor).toBeVisible();
  await editor.locator('[data-field="description"]').fill('PAN EDITADO');
  await editor.getByRole('button', { name: 'Guardar línea', exact: true }).click();
  await expect(compactLine).toContainText('PAN EDITADO');
  await page.locator('#receipt-review-capture').selectOption({ label: 'Imagen 2: auto-2.png' });
  await expect(page.locator('#receipt-review-reference-image')).toHaveAttribute('alt', /auto-2\.png/u);
  await expect(compactLine).toContainText('PAN EDITADO');
});

test('durable AI failure retries from server OCR without replaying browser OCR', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));

  let browserOcrCalls = 0;
  let jobCreates = 0;
  const createPayloads = [];
  await page.route('**/api/v1/receipts/extract', async route => {
    const body = route.request().postDataJSON();
    const capture = body.captures?.[0];
    if (body.verifyWithAi === false && body.captures?.length === 1 && !capture?.embeddedText) {
      browserOcrCalls += 1;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: extraction() }),
    });
  });
  await page.route('**/api/v1/receipts/extraction-jobs', async route => {
    const body = route.request().postDataJSON();
    jobCreates += 1;
    createPayloads.push(body);
    expect(body.verifyWithAi).toBe(true);
    expect(body.captures).toHaveLength(1);
    expect(body.captures[0]).not.toHaveProperty('embeddedText');
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        job: { id: `receiptextractionjob_ai_${jobCreates}`, status: 'queued' },
      }),
    });
  });
  await page.route('**/api/v1/receipts/extraction-jobs/*', async route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    if (id === 'receiptextractionjob_ai_1') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ job: { id, status: 'failed', errorCode: 'AI_UNREACHABLE' } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        job: {
          id,
          status: 'completed',
          extraction: extraction('PAN CORREGIDO 1,50\nTOTAL 1,50', { verified: true }),
        },
      }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-analysis-options').getByText('Opciones de análisis', { exact: true }).click();
  const aiInput = page.locator('#verify-receipt-ai');
  await aiInput.check();
  await upload(page, ['ai-fallback.png']);

  await expect.poll(() => jobCreates).toBe(1);
  expect(browserOcrCalls).toBe(0);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');
  await expect(page.getByText('private upstream detail')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revisar manualmente', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Volver a analizar con IA', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Volver a analizar con IA', exact: true }).click();
  await expect.poll(() => jobCreates).toBe(2);
  expect(browserOcrCalls).toBe(0);
  expect(createPayloads[0]).not.toHaveProperty('retryOfJobId');
  expect(createPayloads[1]?.retryOfJobId).toBe('receiptextractionjob_ai_1');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  await expect(page.locator('#receipt-review-panel')).toHaveAttribute('open', '');
  await expect(page.locator('#receipt-review-reference-image')).toBeVisible();
  await expect(page.locator('.receipt-item [data-field="description"]')).toBeEditable();
  await expect(page.getByRole('button', { name: 'Volver a analizar con IA', exact: true })).toHaveCount(0);
});

test('mobile review keeps preview, calculated amount and final action in one sticky row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));
  const items = Array.from({ length: 8 }, (_, index) => item(`PRODUCTO ${index + 1}`, 100 + index));
  await page.route('**/api/v1/receipts/extract', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ extraction: extraction('PRODUCTOS\nTOTAL', { items }) }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await upload(page, ['sticky-mobile-1.png', 'sticky-mobile-2.png']);
  await expect(page.locator('#receipt-review-panel')).toHaveAttribute('open', '');

  const stickySummary = page.locator('#receipt-review-sticky-summary');
  const preview = page.getByRole('button', { name: 'Ampliar captura sticky-mobile-1.png', exact: true });
  const amount = stickySummary.locator('.review-total strong');
  const finalize = stickySummary.getByRole('button', { name: 'Validar', exact: true });

  await expect(page.locator('.receipt-review-evidence__compact')).toBeHidden();
  await expect(preview).toBeVisible();
  await expect(preview).toHaveText('');
  await expect(preview.locator('.icon')).toBeVisible();
  await expect(page.locator('.receipt-review-reference')).toBeVisible();
  await expect(stickySummary.getByText('Total calculado', { exact: true })).toBeHidden();
  await expect(stickySummary.locator('.status-pill')).toBeHidden();
  await expect(amount).toContainText(/€|euros?/u);
  await expect(finalize).toBeVisible();

  await page.locator('#receipt-review-capture').selectOption({ label: 'Imagen 2: sticky-mobile-2.png' });
  await expect(page.getByRole('button', { name: 'Ampliar captura sticky-mobile-2.png', exact: true })).toBeVisible();

  const compactLine = page.locator('.receipt-line-compact').first();
  await compactLine.click();
  const editor = page.locator('#receipt-line-dialog');
  await editor.locator('[data-field="description"]').fill('PRODUCTO EDITADO');
  await editor.getByRole('button', { name: 'Guardar línea', exact: true }).click();
  await page.locator('#receipt-review-capture').selectOption({ label: 'Imagen 1: sticky-mobile-1.png' });
  await expect(compactLine).toContainText('PRODUCTO EDITADO');
  await expect(page.getByRole('button', { name: 'Ampliar captura sticky-mobile-1.png', exact: true })).toBeVisible();

  await page.locator('.receipt-line-compact').last().scrollIntoViewIfNeeded();
  const geometry = await page.evaluate(() => {
    const summaryElement = document.querySelector('#receipt-review-sticky-summary');
    const previewElement = document.querySelector('#receipt-review-expand');
    const amountElement = summaryElement.querySelector('.review-total strong');
    const finalizeElement = document.querySelector('#confirm-receipt');
    const navElement = document.querySelector('.bottom-nav');
    const summaryRect = summaryElement.getBoundingClientRect();
    const navRect = navElement.getBoundingClientRect();
    const centers = [previewElement, amountElement, finalizeElement].map(element => {
      const rect = element.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    return {
      summaryPosition: getComputedStyle(summaryElement).position,
      summaryTop: getComputedStyle(summaryElement).top,
      summaryBottom: getComputedStyle(summaryElement).bottom,
      summaryHeight: summaryRect.height,
      summaryBottomEdge: summaryRect.bottom,
      navTop: navRect.top,
      centerSpread: Math.max(...centers) - Math.min(...centers),
    };
  });
  expect(geometry.summaryPosition).toBe('sticky');
  expect(geometry.summaryTop).not.toBe('auto');
  expect(geometry.summaryBottom).toBe('auto');
  expect(geometry.summaryHeight).toBeLessThanOrEqual(72);
  expect(geometry.centerSpread).toBeLessThanOrEqual(8);
  expect(geometry.summaryBottomEdge).toBeLessThan(geometry.navTop);

  await page.locator('.manual-entry > summary').click();
  const totalInput = page.locator('#receipt-total');
  await totalInput.focus();
  await expect.poll(() => page.evaluate(() => {
    const input = document.querySelector('#receipt-total').getBoundingClientRect();
    const summary = document.querySelector('#receipt-review-sticky-summary').getBoundingClientRect();
    const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
    return input.top >= summary.bottom && input.bottom <= nav.top;
  })).toBe(true);

  await preview.click();
  await expect(page.locator('#capture-preview-dialog')).toBeVisible();
  await expect(page.locator('#capture-preview-name')).toContainText('sticky-mobile-1.png');
});

test('desktop review keeps evidence and total summary sticky and preserves confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));
  const items = Array.from({ length: 12 }, (_, index) => item(`DESKTOP ${index + 1}`, 125 + index));
  await page.route('**/api/v1/receipts/extract', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ extraction: extraction('DESKTOP RECEIPT\nTOTAL', { items }) }),
  }));
  await page.route('**/api/v1/receipts/validate', async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        lines: body.items.map(entry => ({
          validation: {
            status: 'confirmed',
            expectedMinor: entry.lineTotalMinor,
            differenceMinor: 0,
          },
        })),
        total: {
          expectedMinor: body.declaredTotalMinor,
          differenceMinor: 0,
          valid: true,
        },
      }),
    });
  });
  await page.route('**/api/v1/receipts/confirm', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ receiptId: 'sticky-desktop' }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await upload(page, ['sticky-desktop.png']);
  await expect(page.locator('#receipt-review-panel')).toHaveAttribute('open', '');
  await expect(page.locator('.receipt-review-reference')).toBeVisible();
  await expect(page.locator('#receipt-review-reference-image')).toBeVisible();
  await expect(page.locator('#receipt-review-sticky-summary')).toContainText('Total calculado');
  await expect(page.locator('#receipt-review-sticky-summary .status-pill')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar e importar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Ampliar captura/u })).toBeHidden();

  await page.locator('.receipt-line-compact').last().scrollIntoViewIfNeeded();
  const geometry = await page.evaluate(() => {
    const body = document.querySelector('.receipt-review-panel__body');
    const evidence = document.querySelector('.receipt-review-evidence');
    const summary = document.querySelector('#receipt-review-sticky-summary');
    const evidenceRect = evidence.getBoundingClientRect();
    const summaryRect = summary.getBoundingClientRect();
    const bodyStyle = getComputedStyle(body);
    return {
      columns: bodyStyle.gridTemplateColumns,
      evidencePosition: getComputedStyle(evidence).position,
      summaryPosition: getComputedStyle(summary).position,
      evidenceTop: evidenceRect.top,
      summaryTop: summaryRect.top,
    };
  });
  expect(geometry.columns.split(' ').length).toBeGreaterThanOrEqual(2);
  expect(geometry.evidencePosition).toBe('sticky');
  expect(geometry.summaryPosition).toBe('sticky');
  expect(geometry.evidenceTop).toBeGreaterThanOrEqual(0);
  expect(geometry.summaryTop).toBeGreaterThanOrEqual(0);

  await page.getByRole('button', { name: 'Confirmar e importar', exact: true }).click();
  await expect(page.locator('#receipt-state')).toContainText('Ticket importado: sticky-desktop');
});
