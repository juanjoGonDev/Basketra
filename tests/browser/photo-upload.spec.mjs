import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);

function watchBrowser(page, allowExpectedServerError = false) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    const text = message.text();
    if (allowExpectedServerError && text.includes('500 (Internal Server Error)')) return;
    if (message.type() === 'error') failures.push(`console: ${text}`);
  });
  page.on('requestfailed', request => {
    const reason = request.failure()?.errorText ?? '';
    if (!reason.includes('net::ERR_ABORTED')) failures.push(`request: ${request.method()} ${reason}`);
  });
  return failures;
}

async function openTickets(page, allowExpectedServerError = false) {
  const failures = watchBrowser(page, allowExpectedServerError);
  await page.goto('/');
  await expect(page.locator('#connection-state')).toContainText('Conectado');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
  await expect(
    page.locator('[data-view="scan"].active').getByRole('heading', { name: 'Captura y revisa', exact: true }),
  ).toBeVisible();
  return failures;
}

async function expectLoadedImages(page, count) {
  const images = page.locator('#capture-list img[data-capture-preview-image]');
  await expect(images).toHaveCount(count);
  await expect.poll(() => images.evaluateAll(items => items.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
}

async function expectNoOverflow(page) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
}

test('camera and gallery photos upload, deduplicate and persist after reload', async ({ page }) => {
  const failures = await openTickets(page);
  const storageKeys = [];
  page.on('response', async response => {
    if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== '/api/v1/files' || response.status() !== 201) return;
    storageKeys.push((await response.json()).file.storageKey);
  });

  await page.locator('#receipt-camera').setInputFiles({ name: 'camera.png', mimeType: 'image/png', buffer: validPng });
  await page.locator('#receipt-files').setInputFiles([
    { name: 'gallery.png', mimeType: 'image/png', buffer: validPng },
    { name: 'gallery-copy.png', mimeType: 'image/png', buffer: validPng },
  ]);

  await expect(page.locator('#capture-list li')).toHaveCount(3);
  await expect(page.locator('#upload-state')).toContainText('Capturas guardadas');
  await expectLoadedImages(page, 3);
  await expect.poll(() => storageKeys.length).toBe(3);
  expect(new Set(storageKeys).size).toBe(1);

  await page.reload();
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
  await expect(page.locator('#capture-list li')).toHaveCount(3);
  await expectLoadedImages(page, 3);
  await page.getByRole('button', { name: 'Ampliar camera.png' }).click();
  await expect.poll(() => page.locator('#capture-preview-image').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: 'Cerrar vista previa' }).click();
  await expectNoOverflow(page);
  expect(failures).toEqual([]);
});

test('a failed photo upload preserves the draft and succeeds on retry', async ({ page }) => {
  const failures = await openTickets(page, true);
  await page.locator('#receipt-camera').setInputFiles({ name: 'existing.png', mimeType: 'image/png', buffer: validPng });
  await expect(page.locator('#capture-list li')).toHaveCount(1);

  let failNext = true;
  await page.route('**/api/v1/files', async route => {
    if (route.request().method() === 'POST' && failNext) {
      failNext = false;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected upload failure. Reference: incident-upload-test' } }),
      });
      return;
    }
    await route.continue();
  });

  const retry = { name: 'retry.png', mimeType: 'image/png', buffer: validPng };
  await page.locator('#receipt-files').setInputFiles(retry);
  await expect(page.locator('#upload-state')).toContainText('incident-upload-test');
  await expect(page.locator('#capture-list li')).toHaveCount(1);
  await expect(page.locator('#capture-list')).toContainText('existing.png');

  await page.locator('#receipt-files').setInputFiles(retry);
  await expect(page.locator('#upload-state')).toContainText('Capturas guardadas');
  await expect(page.locator('#capture-list li')).toHaveCount(2);
  await expect(page.locator('#capture-list')).toContainText('retry.png');
  await expectLoadedImages(page, 2);
  await expectNoOverflow(page);
  expect(failures).toEqual([]);
});
