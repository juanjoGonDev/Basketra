import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

function receiptItem(description, storageKey) {
  return {
    description,
    quantity: 1,
    unitPriceMinor: 120,
    lineTotalMinor: 120,
    confidence: 0.93,
    sourceLines: [1],
    captureStorageKey: storageKey,
    sourceRegion: { x: 0.08, y: 0.18, width: 0.78, height: 0.08 },
    fieldConfidence: {
      description: 0.93,
      quantity: 0.93,
      unitPriceMinor: 0.93,
      lineTotalMinor: 0.93,
    },
  };
}

function review(item) {
  return {
    lines: [{
      ...item,
      status: 'confirmed',
      expectedMinor: item.lineTotalMinor,
      differenceMinor: 0,
    }],
    total: { expectedMinor: 120, differenceMinor: 0, valid: true },
  };
}

function pageEvidence(storageKey, { aiFailure = false, aiDescription } = {}) {
  const deterministicItem = receiptItem('LECHE', storageKey);
  const evidence = {
    position: 0,
    storageKey,
    mimeType: 'image/png',
    text: 'LECHE 1,20\nTOTAL 1,20',
    confidence: 0.93,
    source: aiDescription ? 'embedded-text' : 'local-tesseract',
    lines: [
      {
        index: 1,
        text: 'LECHE 1,20',
        confidence: 0.93,
        region: { x: 0.08, y: 0.18, width: 0.78, height: 0.08 },
      },
      {
        index: 2,
        text: 'TOTAL 1,20',
        confidence: 0.97,
        region: { x: 0.55, y: 0.88, width: 0.35, height: 0.05 },
      },
    ],
    deterministic: {
      items: [deterministicItem],
      metadata: { declaredTotalMinor: 120 },
    },
  };
  if (aiFailure) evidence.aiFailure = { code: 'AI_UNREACHABLE' };
  if (aiDescription) {
    evidence.ai = {
      attempts: 1,
      interpretation: {
        currency: 'EUR',
        correctedText: `${aiDescription} 1,20\nTOTAL 1,20`,
        declaredTotalMinor: 120,
        items: [{
          description: aiDescription,
          quantity: 1,
          unitPriceMinor: 120,
          lineTotalMinor: 120,
          confidence: 0.98,
          sourceLines: [1],
        }],
        warnings: [],
      },
    };
  }
  return evidence;
}

function extractionForEvidence(evidence) {
  const item = evidence.ai?.interpretation.items[0]
    ? { ...receiptItem(evidence.ai.interpretation.items[0].description, evidence.storageKey), confidence: 0.98 }
    : receiptItem('LECHE', evidence.storageKey);
  return {
    pages: [evidence],
    originalText: evidence.text,
    deterministic: {
      items: [receiptItem('LECHE', evidence.storageKey)],
      declaredTotalMinor: 120,
    },
    final: {
      items: [item],
      declaredTotalMinor: 120,
      warnings: evidence.aiFailure ? ['AI verification unavailable for one receipt page'] : [],
      review: review(item),
    },
  };
}

function assembledExtraction(storageKey, description) {
  const item = receiptItem(description, storageKey);
  return {
    pages: [pageEvidence(storageKey)],
    originalText: `${description};1;120;120\nTOTAL 1,20`,
    deterministic: { items: [item], declaredTotalMinor: 120 },
    final: {
      items: [item],
      declaredTotalMinor: 120,
      warnings: [],
      review: review(item),
    },
  };
}

test('AI failure keeps OCR rows usable and AI-only retry preserves a manual correction', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let storageKey = '';
  let jobPosts = 0;
  let assemblyPosts = 0;
  let retryBody;

  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));

  await page.route('**/api/v1/receipts/extraction-jobs**', route => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    if (method === 'POST' && url.pathname === '/api/v1/receipts/extraction-jobs') {
      jobPosts += 1;
      const body = route.request().postDataJSON();
      storageKey ||= body.captures[0].storageKey;
      if (jobPosts === 2) retryBody = body;
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          job: {
            id: jobPosts === 1 ? 'receiptextractionjob_ocrwarning' : 'receiptextractionjob_airetry',
            status: 'queued',
          },
        }),
      });
    }

    if (method === 'GET' && url.pathname.endsWith('receiptextractionjob_ocrwarning')) {
      const evidence = pageEvidence(storageKey, { aiFailure: true });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job: {
            id: 'receiptextractionjob_ocrwarning',
            status: 'completed',
            extraction: extractionForEvidence(evidence),
          },
        }),
      });
    }

    if (method === 'GET' && url.pathname.endsWith('receiptextractionjob_airetry')) {
      const evidence = pageEvidence(storageKey, { aiDescription: 'Leche IA' });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job: {
            id: 'receiptextractionjob_airetry',
            status: 'completed',
            extraction: extractionForEvidence(evidence),
          },
        }),
      });
    }

    return route.continue();
  });

  await page.route('**/api/v1/receipts/extract', route => {
    const body = route.request().postDataJSON();
    assemblyPosts += 1;
    const text = body.captures?.[0]?.embeddedText || '';
    const description = text.includes('Leche IA') ? 'Leche IA' : 'LECHE';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: assembledExtraction(storageKey, description) }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-files').setInputFiles({
    name: 'ocr-first.png',
    mimeType: 'image/png',
    buffer: validPng,
  });

  await expect(page.locator('.capture-card .status-pill')).toHaveText('OCR listo · IA pendiente');
  await expect(page.locator('#receipt-state')).toContainText('OCR');
  await expect(page.locator('.receipt-item')).toHaveCount(1);
  await expect(page.locator('.receipt-line-compact')).toContainText('LECHE');
  await page.screenshot({ path: testInfo.outputPath('ocr-ready-ai-warning.png'), fullPage: false });

  await page.locator('[data-tab-group="tickets"]').getByRole('tab', { name: 'Capturas', exact: true }).click();
  await page.getByRole('button', { name: 'Revisar manualmente', exact: true }).click();
  const dialog = page.locator('#receipt-line-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.receipt-line-evidence')).toBeVisible();
  await expect(dialog.locator('.receipt-line-evidence img')).toHaveAttribute('src', new RegExp(`/api/v1/files/${storageKey}`));
  await expect(dialog.locator('.receipt-line-evidence__region')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('manual-review-with-source.png'), fullPage: false });

  await dialog.locator('[data-field="description"]').fill('Leche revisada');
  await dialog.getByRole('button', { name: 'Guardar línea', exact: true }).click();
  await expect(page.locator('.receipt-line-compact')).toContainText('Leche revisada');

  await page.locator('[data-tab-group="tickets"]').getByRole('tab', { name: 'Capturas', exact: true }).click();
  await page.getByRole('button', { name: 'Reintentar IA', exact: true }).click();

  await expect.poll(() => jobPosts).toBe(2);
  expect(retryBody.verifyWithAi).toBe(true);
  expect(retryBody.captures).toHaveLength(1);
  expect(retryBody.captures[0].storageKey).toBe(storageKey);
  expect(retryBody.captures[0].embeddedText).toBe('LECHE 1,20\nTOTAL 1,20');
  await expect.poll(() => assemblyPosts).toBeGreaterThanOrEqual(2);

  await page.locator('[data-tab-group="tickets"]').getByRole('tab', { name: 'Revisión', exact: true }).click();
  await expect(page.locator('.receipt-line-compact')).toContainText('Leche revisada');
  await expect(page.locator('.receipt-line-compact')).not.toContainText('Leche IA');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
});
