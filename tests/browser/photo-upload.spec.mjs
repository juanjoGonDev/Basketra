import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);
const DEFAULT_IMAGE_LIMIT = 20 * 1024 * 1024;
const DEFAULT_FILE_LIMIT = 512 * 1024 * 1024;

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

async function installRuntimeCapabilities(page, getImageLimit = () => DEFAULT_IMAGE_LIMIT) {
  let reads = 0;
  await page.route('**/api/v1/ai/runtime-capabilities', async route => {
    reads += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        attachments: {
          maxCount: 10,
          maxFileBytes: DEFAULT_FILE_LIMIT,
          maxImageBytes: getImageLimit(),
          maxSpreadsheetBytes: 50 * 1024 * 1024,
          maxUploadsPerThreeHours: 80,
        },
        execution: { replyInactivityTimeoutMs: 120_000 },
        requests: { maxJsonBodyBytes: 500 * 1024 * 1024 },
      }),
    });
  });
  return () => reads;
}

async function enableAiUploadPreflight(page) {
  await page.evaluate(async () => {
    const { state } = await import('/receipt-state.js');
    state.aiConfigured = true;
    const checkbox = document.querySelector('#verify-receipt-ai');
    if (checkbox instanceof HTMLInputElement) checkbox.checked = true;
  });
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
  await installRuntimeCapabilities(page);
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

test('oversized photo uses the latest WebAPI limit without blocking local OCR', async ({ page }) => {
  let configuredLimit = 2 * 1024 * 1024;
  const capabilityReads = await installRuntimeCapabilities(page, () => configuredLimit);
  const failures = await openTickets(page);
  await enableAiUploadPreflight(page);

  await page.locator('#receipt-files').setInputFiles({
    name: 'baseline.png',
    mimeType: 'image/png',
    buffer: validPng,
  });
  await expect(page.locator('#capture-list li')).toHaveCount(1);
  expect(capabilityReads()).toBe(1);

  configuredLimit = 1024 * 1024;
  await page.locator('#receipt-files').setInputFiles({
    name: 'large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(configuredLimit + (configuredLimit / 2)),
  });

  await expect(page.locator('#upload-state')).toHaveText(
    'Capturas guardadas. OCR iniciado. El archivo large.png ocupa 1,5 MB y supera el límite de 1 MB',
  );
  await expect(page.locator('#capture-list li')).toHaveCount(2);
  expect(capabilityReads()).toBe(2);
  expect(failures).toEqual([]);
});

test('a failed photo upload preserves the draft and succeeds on retry', async ({ page }) => {
  await installRuntimeCapabilities(page);
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
