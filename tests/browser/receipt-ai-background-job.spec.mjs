import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);

function localExtraction(text = 'PAN 1,50\nTOTAL 1,50') {
  return {
    pages: [{ position: 0, source: 'local-tesseract', text, confidence: 0.8 }],
    originalText: text,
    deterministic: {
      items: [{ description: 'PAN', quantity: 1, unitPriceMinor: 150, lineTotalMinor: 150, confidence: 0.8, sourceLines: [1] }],
      declaredTotalMinor: 150,
    },
    final: {
      items: [{ description: 'PAN', quantity: 1, unitPriceMinor: 150, lineTotalMinor: 150, confidence: 0.8, sourceLines: [1] }],
      declaredTotalMinor: 150,
      warnings: [],
    },
  };
}

async function installControlledEventSource(page) {
  await page.addInitScript(() => {
    class ControlledEventSource {
      constructor() {
        this.listeners = new Map();
        this.closed = false;
        window.__receiptEventSources ??= [];
        window.__receiptEventSources.push(this);
      }

      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }

      emit(type, data = '') {
        for (const listener of this.listeners.get(type) ?? []) listener({ data });
      }

      close() {
        this.closed = true;
      }
    }
    window.EventSource = ControlledEventSource;
  });
}

async function prepareReceipt(page, name = 'receipt.png') {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  await page.goto('/');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
  await page.locator('#receipt-files').setInputFiles({ name, mimeType: 'image/png', buffer: validPng });
  await expect(page.locator('.capture-card')).toHaveCount(1);
}

test('AI-enabled automatic analysis uses one whole-ticket durable job and no browser OCR request', async ({ page }) => {
  await installControlledEventSource(page);
  let directExtractionRequests = 0;
  let jobCreates = 0;

  await page.route('**/api/v1/receipts/extract', route => {
    directExtractionRequests += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'LEGACY_EXTRACTION_MUST_NOT_RUN' } }) });
  });
  await page.route('**/api/v1/receipts/extraction-jobs', route => {
    jobCreates += 1;
    const body = route.request().postDataJSON();
    expect(body.verifyWithAi).toBe(true);
    expect(body.captures).toHaveLength(1);
    expect(body.captures[0]).not.toHaveProperty('embeddedText');
    return route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: 'receiptextractionjob_async1', status: 'queued' } }),
    });
  });
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_async1', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: 'receiptextractionjob_async1', status: 'completed', extraction: localExtraction() } }),
  }));

  await prepareReceipt(page);

  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  expect(jobCreates).toBe(1);
  expect(directExtractionRequests).toBe(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.receiptExtractionJobId'))).toBe('receiptextractionjob_async1');
});

test('AI job state is recovered on realtime reconnect without interval polling', async ({ page }) => {
  await installControlledEventSource(page);
  let jobStatus = 'running';
  let statusReads = 0;

  await page.route('**/api/v1/receipts/extract', route => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'LEGACY_EXTRACTION_MUST_NOT_RUN' } }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs', route => route.fulfill({
    status: 202,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: 'receiptextractionjob_reconnect', status: 'queued' } }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_reconnect', route => {
    statusReads += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        job: jobStatus === 'completed'
          ? { id: 'receiptextractionjob_reconnect', status: 'completed', extraction: localExtraction() }
          : { id: 'receiptextractionjob_reconnect', status: 'running' },
      }),
    });
  });

  await prepareReceipt(page, 'reconnect.png');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Verificando con IA');
  expect(statusReads).toBe(1);

  jobStatus = 'completed';
  await page.evaluate(() => window.__receiptEventSources.at(-1).emit('open'));
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  expect(statusReads).toBe(2);
});

test('cancelling during durable job creation deletes the late-created job without replaying work', async ({ page }) => {
  await installControlledEventSource(page);
  let jobCreates = 0;
  let jobDeletes = 0;
  let releaseCreation = () => {};
  const creationResponseGate = new Promise(resolve => { releaseCreation = resolve; });

  await page.route('**/api/v1/receipts/extract', route => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'LEGACY_EXTRACTION_MUST_NOT_RUN' } }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs', async route => {
    jobCreates += 1;
    await creationResponseGate;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: 'receiptextractionjob_cancel', status: 'queued' } }),
    }).catch(() => {});
  });
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_cancel', route => {
    if (route.request().method() === 'DELETE') {
      jobDeletes += 1;
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: 'receiptextractionjob_cancel', status: 'running' } }),
    });
  });

  await prepareReceipt(page, 'cancel-during-create.png');
  await expect.poll(() => jobCreates).toBe(1);
  await page.getByRole('button', { name: 'Cancelar procesamiento', exact: true }).click();
  releaseCreation();

  await expect.poll(() => jobDeletes).toBe(1);
  expect(jobCreates).toBe(1);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.receiptExtractionJobId'))).toBeNull();
});

test('failed durable AI job exposes a copyable redacted diagnostic', async ({ page }) => {
  await installControlledEventSource(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async text => { window.__copiedReceiptDiagnostic = text; } },
    });
  });
  const secretOcr = 'PRIVATE OCR CONTENT 998877';
  const secretFilename = 'private-household-receipt.png';

  await page.route('**/api/v1/receipts/extract', route => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: secretOcr } }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs', route => route.fulfill({
    status: 202,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: 'receiptextractionjob_diag123', status: 'queued' } }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs/receiptextractionjob_diag123', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: 'receiptextractionjob_diag123', status: 'failed', errorCode: 'AI_PROVIDER_FAILED' } }),
  }));

  await prepareReceipt(page, secretFilename);

  await expect(page.getByRole('button', { name: 'Copiar diagnóstico', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Copiar diagnóstico', exact: true }).click();
  const diagnostic = await page.evaluate(() => window.__copiedReceiptDiagnostic);
  expect(diagnostic).toContain('AI_PROVIDER_FAILED');
  expect(diagnostic).toContain('receiptextractionjob_diag123');
  expect(diagnostic).not.toContain(secretOcr);
  expect(diagnostic).not.toContain(secretFilename);
});
