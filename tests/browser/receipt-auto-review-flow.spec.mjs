import { test, expect } from '@playwright/test';
import { fillRequiredReceiptStore } from './helpers/receipt-store.mjs';

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

  await expect(page.getByText('Paso 1', { exact: true })).toBeHidden();
  await expect(page.getByText('Paso 2', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Leer con OCR local', exact: true })).toHaveCount(0);
  await expect(page.locator('#receipt-analysis-options')).toHaveCount(0);

  await upload(page, ['auto-1.png', 'auto-2.png', 'auto-3.png']);

  await expect.poll(() => startedOcr).toBe(2);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'OCR local' })).toHaveCount(2);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Pendiente' })).toHaveCount(1);
  await expect(page.locator('#receipt-progress-detail')).toContainText('2 procesando');
  await expect(page.locator('#receipt-progress-detail')).toContainText('1 pendientes');

  releaseOcr();
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Completada' })).toHaveCount(3);
  await expect(page.locator('#receipt-progress')).toBeHidden();
  await expect(page.locator('#receipt-review-panel')).not.toHaveAttribute('open', '');
  await expect(page.locator('#receipt-detected-list')).toContainText('PAN');
  // The detected row is the only line surface; the review panel stays withdrawn.
  const detectedLine = page.locator('#receipt-detected-list .receipt-detected-item').first();
  await detectedLine.click();
  const editor = page.locator('#receipt-line-dialog');
  await expect(editor).toBeVisible();
  await editor.locator('[data-field="description"]').fill('PAN EDITADO');
  await editor.getByRole('button', { name: 'Guardar línea', exact: true }).click();
  await expect(page.locator('#receipt-detected-list')).toContainText('PAN EDITADO');
  await expect(page.locator('#receipt-review-panel')).not.toHaveAttribute('open', '');
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
  await upload(page, ['ai-fallback.png']);

  await expect.poll(() => jobCreates).toBe(1);
  expect(browserOcrCalls).toBe(0);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');
  await expect(page.getByText('private upstream detail')).toHaveCount(0);
  const queue = page.locator('#receipt-source-queue');
  if (!(await queue.evaluate(element => element.open))) {
    await queue.locator(':scope > summary').click();
  }
  const details = page.locator('.capture-card__details').first();
  if (!(await details.evaluate(element => element.open))) {
    await details.locator(':scope > summary').click();
  }
  await expect(details.getByRole('button', { name: 'Revisar manualmente', exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Volver a analizar con IA', exact: true })).toBeVisible();

  await details.getByRole('button', { name: 'Volver a analizar con IA', exact: true }).click();
  await expect.poll(() => jobCreates).toBe(2);
  expect(browserOcrCalls).toBe(0);
  expect(createPayloads[0]).not.toHaveProperty('retryOfJobId');
  expect(createPayloads[1]?.retryOfJobId).toBe('receiptextractionjob_ai_1');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  await expect(page.locator('#receipt-detected-list')).toContainText('PAN');
  await expect(page.getByRole('button', { name: 'Volver a analizar con IA', exact: true })).toHaveCount(0);
});

test('mobile review groups evidence, calculated amount and final action in the summary', async ({ page }) => {
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
  await expect(page.locator('#receipt-review-panel')).not.toHaveAttribute('open', '');

  // The calculated-total summary owns evidence, validation and confirmation.
  const summary = page.locator('#receipt-live-summary');
  const evidence = page.locator('#receipt-show-evidence');
  const validate = page.locator('#validate-receipt-ticket');
  const finalize = page.locator('#confirm-receipt');
  await expect(summary).toBeVisible();
  await expect(summary.locator('#receipt-summary-total')).toContainText(/\u20ac|euros?/u);
  for (const action of [evidence, validate, finalize]) await expect(action).toBeVisible();

  const detectedLine = page.locator('#receipt-detected-list .receipt-detected-item').first();
  await detectedLine.click();
  const editor = page.locator('#receipt-line-dialog');
  await expect(editor).toBeVisible();
  await editor.locator('[data-field="description"]').fill('PRODUCTO EDITADO');
  await editor.getByRole('button', { name: 'Guardar l\u00ednea', exact: true }).click();
  await expect(page.locator('#receipt-detected-list')).toContainText('PRODUCTO EDITADO');
  await expect(page.locator('#receipt-review-panel')).not.toHaveAttribute('open', '');

  const actions = page.locator('#receipt-live-summary-actions');
  await actions.scrollIntoViewIfNeeded();
  const geometry = await page.evaluate(() => {
    const owner = document.querySelector('#receipt-live-summary-actions');
    const boxes = ['#receipt-show-evidence', '#validate-receipt-ticket', '#confirm-receipt']
      .map(selector => document.querySelector(selector));
    return {
      grouped: boxes.every(element => owner.contains(element)),
      minHeight: Math.min(...boxes.map(element => element.getBoundingClientRect().height)),
      insideViewport: boxes.every(element => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      }),
    };
  });
  expect(geometry.grouped, `the summary must own every review action: ${JSON.stringify(geometry)}`).toBe(true);
  expect(geometry.minHeight, `summary actions must stay touch-safe: ${JSON.stringify(geometry)}`).toBeGreaterThanOrEqual(44);
  expect(geometry.insideViewport, `summary actions must be reachable on mobile: ${JSON.stringify(geometry)}`).toBe(true);

  await evidence.click();
  await expect(page.locator('#receipt-evidence-dialog')).toBeVisible();
  await expect(page.locator('#receipt-evidence-dialog')).toContainText('sticky-mobile-1.png');
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
  await expect(page.locator('#receipt-review-panel')).not.toHaveAttribute('open', '');

  // Evidence and the calculated total live in the summary that owns confirmation.
  const summary = page.locator('#receipt-live-summary');
  await expect(summary).toBeVisible();
  await expect(summary.locator('#receipt-summary-total-label')).toContainText('Total');
  await expect(page.locator('#receipt-show-evidence')).toBeVisible();
  await expect(page.locator('#confirm-receipt')).toBeVisible();
  await expect(page.getByRole('button', { name: /Ampliar captura/u })).toBeHidden();

  await page.locator('#receipt-show-evidence').click();
  const evidenceDialog = page.locator('#receipt-evidence-dialog');
  await expect(evidenceDialog).toBeVisible();
  await expect(evidenceDialog.locator('img').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(evidenceDialog).toBeHidden();

  await page.locator('#receipt-detected-list .receipt-detected-item').last().scrollIntoViewIfNeeded();
  await fillRequiredReceiptStore(page);

  await page.locator('#confirm-receipt').click();
  await expect(page.locator('#toast-message')).toHaveText('Ticket confirmado');
});


test('receipt review requires an editable Store before confirmation', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));
  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.evaluate(async () => {
    const { installReceiptEnhancements } = await import('/receipts.js');
    installReceiptEnhancements();
  });
  await page.evaluate(async currentExtraction => {
    const { applyExtraction } = await import('/receipt-review.js');
    applyExtraction(currentExtraction);
  }, extraction());
  await expect(page.locator('#receipt-review-panel')).not.toHaveAttribute('open', '');

  // The Store stays a required review-model field, edited through the shared source
  // editor (covered by components-gallery), and confirmation is blocked without it.
  await expect(page.locator('#receipt-retailer')).toHaveAttribute('required', '');
  await expect(page.locator('#receipt-store')).toHaveAttribute('required', '');
  await page.locator('#confirm-receipt').click();
  await expect(page.locator('#receipt-state')).toContainText('antes de confirmar el ticket.');
});
