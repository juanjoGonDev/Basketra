import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);

function receiptItem() {
  return {
    description: 'PAN',
    quantity: 1,
    unitPriceMinor: 150,
    lineTotalMinor: 150,
    confidence: 0.8,
    sourceLines: [1],
  };
}

function localExtraction(text = 'PAN 1,50\nTOTAL 1,50') {
  const item = receiptItem();
  return {
    pages: [{ position: 0, source: 'local-tesseract', text, confidence: 0.8 }],
    originalText: text,
    deterministic: {
      items: [item],
      declaredTotalMinor: 150,
    },
    final: {
      items: [item],
      declaredTotalMinor: 150,
      warnings: [],
      review: {
        lines: [{
          ...item,
          status: 'confirmed',
          expectedMinor: 150,
          differenceMinor: 0,
        }],
        total: { expectedMinor: 150, differenceMinor: 0, valid: true },
      },
    },
  };
}

function progressiveJob(jobId, text = 'PAN 1,50\nTOTAL 1,50') {
  return {
    id: jobId,
    status: 'running',
    progress: {
      phase: 'ai_running',
      pages: [{
        position: 0,
        stage: 'ai',
        ocr: {
          text,
          confidence: 0.8,
          source: 'local-tesseract',
          deterministic: {
            items: [receiptItem()],
            metadata: { declaredTotalMinor: 150 },
          },
        },
      }],
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

      close() {
        this.closed = true;
      }
    }
    window.EventSource = ControlledEventSource;
  });
}

async function seedStoredCapture(page, suffix = 'a') {
  const storageKey = `${suffix.repeat(64)}.png`;
  const capture = {
    name: 'already-stored-receipt.png',
    mimeType: 'image/png',
    bytes: 128,
    storageKey,
    contentHash: suffix.repeat(64),
  };
  await page.addInitScript(savedCapture => {
    localStorage.setItem('basketra.captures', JSON.stringify([savedCapture]));
    localStorage.removeItem('basketra.receiptExtractionJobId');
  }, capture);
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  return capture;
}

async function openReceipts(page) {
  await page.goto('/');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
}

async function expectProgressiveOcr(page, text) {
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Verificando con IA');
  const captureDetails = page.locator('.capture-card__details').first();
  if (!(await captureDetails.evaluate(element => element.open))) {
    await captureDetails.locator(':scope > summary').click();
  }
  const preview = captureDetails.locator('.capture-card__ocr-preview');
  await expect(preview.locator('summary')).toHaveText('1 producto detectado por OCR');
  await preview.locator('summary').click();
  await expect(preview.locator('.capture-card__ocr-text')).toHaveText(text);
}

test('reload keeps progressive OCR visible without replaying OCR or AI creation', async ({ page }) => {
  await installControlledEventSource(page);

  const jobId = 'receiptextractionjob_reload1';
  const progressiveText = 'PAN 1,50\nTOTAL 1,50';
  let directOcrRequests = 0;
  let jobCreates = 0;
  let jobReads = 0;
  const createPayloads = [];

  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  await page.route('**/api/v1/receipts/extract', route => {
    directOcrRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: localExtraction() }),
    });
  });
  await page.route('**/api/v1/receipts/extraction-jobs', route => {
    jobCreates += 1;
    createPayloads.push(route.request().postDataJSON());
    return route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: jobId, status: 'queued' } }),
    });
  });
  await page.route(`**/api/v1/receipts/extraction-jobs/${jobId}`, route => {
    jobReads += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: progressiveJob(jobId, progressiveText) }),
    });
  });

  await page.goto('/');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
  await page.locator('#receipt-files').setInputFiles({
    name: 'persisted-receipt.png',
    mimeType: 'image/png',
    buffer: validPng,
  });

  await expect.poll(() => jobCreates).toBe(1);
  expect(directOcrRequests).toBe(0);
  expect(createPayloads).toHaveLength(1);
  expect(createPayloads[0]?.verifyWithAi).toBe(true);
  expect(createPayloads[0]?.captures).toHaveLength(1);
  expect(createPayloads[0]?.captures[0]).not.toHaveProperty('embeddedText');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.receiptExtractionJobId'))).toBe(jobId);
  await expectProgressiveOcr(page, progressiveText);
  await expect.poll(() => page.evaluate(text => Object.values(localStorage).some(value => String(value).includes(text)), progressiveText)).toBe(false);

  const readsBeforeReload = jobReads;
  await page.reload();
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();

  await expect.poll(() => jobReads).toBeGreaterThan(readsBeforeReload);
  expect(jobCreates).toBe(1);
  expect(directOcrRequests).toBe(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.receiptExtractionJobId'))).toBe(jobId);
  await expect(page.locator('.capture-card')).toHaveCount(1);
  await expectProgressiveOcr(page, progressiveText);
  await expect.poll(() => page.evaluate(text => Object.values(localStorage).some(value => String(value).includes(text)), progressiveText)).toBe(false);
});

test('stored captures without local job identity adopt the exact durable job instead of creating work', async ({ page }) => {
  await installControlledEventSource(page);

  const jobId = 'receiptextractionjob_orphan1';
  const capture = await seedStoredCapture(page);
  let recoveryRequests = 0;
  let jobCreates = 0;
  let directOcrRequests = 0;
  let jobReads = 0;

  await page.route('**/api/v1/receipts/extract', route => {
    directOcrRequests += 1;
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'DUPLICATE_OCR_MUST_NOT_RUN' } }),
    });
  });
  await page.route('**/api/v1/receipts/extraction-jobs/recover', route => {
    recoveryRequests += 1;
    const body = route.request().postDataJSON();
    expect(body.captures).toEqual([{ storageKey: capture.storageKey, originalName: capture.name }]);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: jobId, status: 'running' } }),
    });
  });
  await page.route('**/api/v1/receipts/extraction-jobs', route => {
    jobCreates += 1;
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'DUPLICATE_JOB_MUST_NOT_RUN' } }),
    });
  });
  await page.route(`**/api/v1/receipts/extraction-jobs/${jobId}`, route => {
    jobReads += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: jobId, status: 'running' } }),
    });
  });

  await openReceipts(page);

  await expect.poll(() => recoveryRequests).toBe(1);
  await expect.poll(() => jobReads).toBeGreaterThan(0);
  expect(jobCreates).toBe(0);
  expect(directOcrRequests).toBe(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.receiptExtractionJobId'))).toBe(jobId);
  await expect(page.locator('.capture-card')).toHaveCount(1);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Verificando con IA');
});

test('recovery lookup failure fails closed without creating OCR or AI work', async ({ page }) => {
  await installControlledEventSource(page);
  await seedStoredCapture(page, 'b');
  let jobCreates = 0;
  let directOcrRequests = 0;

  await page.route('**/api/v1/receipts/extraction-jobs/recover', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'RECOVERY_UNAVAILABLE' } }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs', route => {
    jobCreates += 1;
    return route.fulfill({ status: 500, body: '' });
  });
  await page.route('**/api/v1/receipts/extract', route => {
    directOcrRequests += 1;
    return route.fulfill({ status: 500, body: '' });
  });

  await openReceipts(page);

  await expect(page.locator('#receipt-state')).toContainText('No se pudo comprobar el trabajo durable existente');
  expect(jobCreates).toBe(0);
  expect(directOcrRequests).toBe(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.receiptExtractionJobId'))).toBeNull();
});

test('invalid recovered job identity fails closed without persisting or creating work', async ({ page }) => {
  await installControlledEventSource(page);
  await seedStoredCapture(page, 'c');
  let jobCreates = 0;
  let directOcrRequests = 0;

  await page.route('**/api/v1/receipts/extraction-jobs/recover', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: 'invalid-job-id', status: 'running' } }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs', route => {
    jobCreates += 1;
    return route.fulfill({ status: 500, body: '' });
  });
  await page.route('**/api/v1/receipts/extract', route => {
    directOcrRequests += 1;
    return route.fulfill({ status: 500, body: '' });
  });

  await openReceipts(page);

  await expect(page.locator('#receipt-state')).toContainText('identidad durable inválida');
  expect(jobCreates).toBe(0);
  expect(directOcrRequests).toBe(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.receiptExtractionJobId'))).toBeNull();
});

test('adopted durable identity remains persisted when its first status read fails', async ({ page }) => {
  await installControlledEventSource(page);
  await seedStoredCapture(page, 'd');
  const jobId = 'receiptextractionjob_statusread1';
  let jobReads = 0;
  let jobCreates = 0;
  let directOcrRequests = 0;

  await page.route('**/api/v1/receipts/extraction-jobs/recover', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: jobId, status: 'running' } }),
  }));
  await page.route(`**/api/v1/receipts/extraction-jobs/${jobId}`, route => {
    jobReads += 1;
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'STATUS_UNAVAILABLE' } }),
    });
  });
  await page.route('**/api/v1/receipts/extraction-jobs', route => {
    jobCreates += 1;
    return route.fulfill({ status: 500, body: '' });
  });
  await page.route('**/api/v1/receipts/extract', route => {
    directOcrRequests += 1;
    return route.fulfill({ status: 500, body: '' });
  });

  await openReceipts(page);

  await expect.poll(() => jobReads).toBe(1);
  await expect(page.locator('#receipt-state')).toContainText('Se recuperó la identidad del análisis');
  expect(jobCreates).toBe(0);
  expect(directOcrRequests).toBe(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.receiptExtractionJobId'))).toBe(jobId);
});
