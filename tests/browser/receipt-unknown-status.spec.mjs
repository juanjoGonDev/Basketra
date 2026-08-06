import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);
const storageKey = 'future-status-storage';

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

test('an unknown future receipt-page status degrades to pending progress', async ({ page }) => {
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
        value.status = 'future-status';
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

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-files').setInputFiles({
    name: 'future-status.png',
    mimeType: 'image/png',
    buffer: validPng,
  });

  await expect(page.locator('.capture-card')).toHaveCount(1);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Pendiente');
  await expect(page.locator('[data-capture-page-progress] [role="progressbar"]'))
    .toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('[data-capture-page-progress] .capture-card__progress-meta span').first())
    .toHaveText('');
});
