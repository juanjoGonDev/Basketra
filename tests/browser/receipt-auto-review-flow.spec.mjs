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

test('AI correction failure keeps OCR reviewable with source image, manual review and AI-only retry', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));

  let ocrCalls = 0;
  let aiCalls = 0;
  let failAi = true;
  await page.route('**/api/v1/receipts/extract', async route => {
    const body = route.request().postDataJSON();
    const capture = body.captures?.[0];
    if (body.verifyWithAi === true) {
      aiCalls += 1;
      expect(capture.embeddedText).toContain('PAN');
      if (failAi) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'AI_UNREACHABLE', message: 'private upstream detail' } }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ extraction: extraction('PAN CORREGIDO 1,50\nTOTAL 1,50', { verified: true }) }),
      });
      return;
    }

    if (body.captures?.length === 1 && !capture.embeddedText) ocrCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: extraction() }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-analysis-options').getByText('Opciones de análisis', { exact: true }).click();
  const aiInput = page.locator('#verify-receipt-ai');
  await aiInput.check();
  await upload(page, ['ai-fallback.png']);

  await expect.poll(() => aiCalls).toBe(1);
  await expect.poll(() => ocrCalls).toBe(1);
  await expect(page.locator('.capture-card .status-pill')).not.toHaveText('Error');
  await expect(page.getByText('private upstream detail')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revisar manualmente', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Volver a analizar con IA', exact: true })).toBeVisible();
  await expect(page.locator('.receipt-item')).toHaveCount(1);

  await page.getByRole('button', { name: 'Revisar manualmente', exact: true }).click();
  await expect(page.locator('#receipt-review-panel')).toHaveAttribute('open', '');
  await expect(page.locator('#receipt-review-reference-image')).toBeVisible();
  await expect(page.locator('#receipt-review-reference-image')).toHaveAttribute('src', /\/api\/v1\/files\//u);
  await expect(page.locator('.receipt-item [data-field="description"]')).toBeEditable();

  failAi = false;
  await page.getByRole('button', { name: 'Volver a analizar con IA', exact: true }).click();
  await expect.poll(() => aiCalls).toBe(2);
  expect(ocrCalls).toBe(1);
  await expect(page.getByRole('button', { name: 'Volver a analizar con IA', exact: true })).toHaveCount(0);
  await expect(page.locator('.capture-card__details')).not.toHaveAttribute('open', '');
});
