import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);
const storageKey = 'future-status-storage';

test('an unknown future receipt-page status degrades to queued progress', async ({ page }) => {
  await page.addInitScript(expectedKey => {
    const originalSet = Map.prototype.set;
    Map.prototype.set = function set(key, value) {
      if (
        key === expectedKey
        && value?.status === 'pending'
        && typeof value.version === 'number'
        && Object.hasOwn(value, 'rawText')
        && Object.hasOwn(value, 'recovery')
      ) {
        let status = 'future-status';
        Object.defineProperty(value, 'status', {
          configurable: true,
          enumerable: true,
          get: () => status,
          set: next => {
            status = next === 'pending' ? 'future-status' : next;
          },
        });
      }
      return originalSet.call(this, key, value);
    };
  }, storageKey);
  await page.route('**/api/v1/files', route => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({
      file: {
        mimeType: 'image/png',
        bytes: validPng.length,
        storageKey,
        hash: 'b'.repeat(64),
      },
    }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs**', route => route.fulfill({
    status: route.request().method() === 'POST' ? 202 : 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: route.request().method() === 'POST'
        ? { id: 'receiptextractionjob_futurestatus' }
        : { id: 'receiptextractionjob_futurestatus', status: 'queued' },
    }),
  }));

  await page.goto('/');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
  await page.locator('#receipt-files').setInputFiles({
    name: 'future-status.png',
    mimeType: 'image/png',
    buffer: validPng,
  });

  await expect(page.locator('.capture-card')).toHaveCount(1);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('En cola');
  await expect(page.locator('[data-capture-page-progress] [role="progressbar"]'))
    .toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('[data-capture-page-progress] .capture-card__progress-meta span').first())
    .toHaveText('');
  await expect(page.getByRole('button', { name: 'Cancelar esta imagen', exact: true })).toBeVisible();
});
