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

      close() {
        this.closed = true;
      }
    }
    window.EventSource = ControlledEventSource;
  });
}

test('reload keeps the initial durable receipt job and does not replay OCR or AI creation', async ({ page }) => {
  await installControlledEventSource(page);

  const jobId = 'receiptextractionjob_reload1';
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
      body: JSON.stringify({ job: { id: jobId, status: 'running' } }),
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

  const readsBeforeReload = jobReads;
  await page.reload();
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();

  await expect.poll(() => jobReads).toBeGreaterThan(readsBeforeReload);
  expect(jobCreates).toBe(1);
  expect(directOcrRequests).toBe(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.receiptExtractionJobId'))).toBe(jobId);
  await expect(page.locator('.capture-card')).toHaveCount(1);
});
