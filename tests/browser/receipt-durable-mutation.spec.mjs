import { test, expect } from '@playwright/test';

async function installControlledEventSource(page) {
  await page.addInitScript(() => {
    class ControlledEventSource {
      constructor() {
        this.listeners = new Map();
      }

      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }

      close() {}
    }
    window.EventSource = ControlledEventSource;
  });
}

function capture(suffix, index) {
  return {
    name: `receipt-${index + 1}.png`,
    mimeType: 'image/png',
    bytes: 128,
    storageKey: `${suffix.repeat(64)}.png`,
    contentHash: suffix.repeat(64),
  };
}

async function seedFailedDurableDraft(page, captures, jobId, onCancel) {
  await installControlledEventSource(page);
  await page.addInitScript(({ savedCaptures, savedJobId }) => {
    localStorage.setItem('basketra.captures', JSON.stringify(savedCaptures));
    localStorage.setItem('basketra.receiptExtractionJobId', savedJobId);
  }, { savedCaptures: captures, savedJobId: jobId });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  await page.route(`**/api/v1/receipts/extraction-jobs/${jobId}`, route => {
    if (route.request().method() === 'DELETE') {
      onCancel();
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: jobId, status: 'failed', errorCode: 'AI_PROVIDER_FAILED' } }),
    });
  });
  await page.goto('/');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
}

async function openCaptureDetails(page, index = 0) {
  const queue = page.locator('#receipt-source-queue');
  if (!(await queue.evaluate(element => element.open))) {
    await queue.locator(':scope > summary').click();
  }
  const details = page.locator('.capture-card__details').nth(index);
  if (!(await details.evaluate(element => element.open))) {
    await details.locator(':scope > summary').click();
  }
  return details;
}

test('explicit capture reorder invalidates the durable job bound to the previous order', async ({ page }) => {
  const jobId = 'receiptextractionjob_reorder1';
  const captures = ['a', 'b'].map(capture);
  let cancellations = 0;
  await seedFailedDurableDraft(page, captures, jobId, () => { cancellations += 1; });
  await expect(page.locator('.capture-card')).toHaveCount(2);
  await expect(page.locator('.capture-card .status-pill')).toHaveText(['Error', 'Error']);

  const reorderDetails = await openCaptureDetails(page, 0);
  await reorderDetails.locator('[data-capture-action="down"]').click();

  await expect.poll(() => cancellations).toBe(1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.receiptExtractionJobId'))).toBeNull();
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('basketra.captures') || '[]'));
  expect(persisted.map(value => value.storageKey)).toEqual([
    captures[1].storageKey,
    captures[0].storageKey,
  ]);
});

test('explicit capture deletion invalidates the durable job bound to the previous draft', async ({ page }) => {
  const jobId = 'receiptextractionjob_delete1';
  const captures = [capture('c', 0)];
  let cancellations = 0;
  await seedFailedDurableDraft(page, captures, jobId, () => { cancellations += 1; });
  await expect(page.locator('.capture-card')).toHaveCount(1);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');

  const deleteDetails = await openCaptureDetails(page, 0);
  await deleteDetails.locator('[data-capture-action="delete"]').click();

  await expect.poll(() => cancellations).toBe(1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('basketra.receiptExtractionJobId'))).toBeNull();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('basketra.captures') || '[]'))).toEqual([]);
  await expect(page.locator('.capture-card')).toHaveCount(0);
});
