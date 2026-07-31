import { test, expect } from '@playwright/test';

const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==', 'base64');
const validJpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCKiiivjz74/9k=', 'base64');

function monitorRuntime(page, { allowExpectedUploadFailure = false } = {}) {
  const failures = [];
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    const text = message.text();
    if (allowExpectedUploadFailure && text.includes('500 (Internal Server Error)')) return;
    if (message.type() === 'error') failures.push(`console: ${text}`);
  });
  page.on('requestfailed', request => {
    const failure = request.failure()?.errorText ?? '';
    if (!failure.includes('net::ERR_ABORTED')) {
      failures.push(`request: ${request.method()} ${request.url()} ${failure}`);
    }
  });
  return failures;
}

async function gotoTickets(page, options) {
  const failures = monitorRuntime(page, options);
  await page.goto('/');
  await expect(page.locator('#connection-state')).toContainText('Conectado');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Digitaliza tickets sin perder el original' })).toBeVisible();
  return failures;
}

async function expectImagesLoaded(page, count) {
  const images = page.locator('#capture-list img[data-capture-preview-image]');
  await expect(images).toHaveCount(count);
  await expect.poll(async () => images.evaluateAll(elements => elements.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

test('real camera and gallery photos upload, deduplicate and persist after reload', async ({ page }) => {
  const failures = await gotoTickets(page);
  const uploadedStorageKeys = [];
  page.on('response', async response => {
    const request = response.request();
    if (request.method() !== 'POST' || new URL(response.url()).pathname !== '/api/v1/files' || response.status() !== 201) return;
    const body = await response.json();
    uploadedStorageKeys.push(body.file.storageKey);
  });

  await page.locator('#receipt-camera').setInputFiles({
    name: 'camera.jpg',
    mimeType: 'image/jpeg',
    buffer: validJpeg,
  });
  await page.locator('#receipt-files').setInputFiles([
    { name: 'gallery.png', mimeType: 'image/png', buffer: validPng },
    { name: 'gallery-copy.png', mimeType: 'image/png', buffer: validPng },
  ]);

  await expect(page.locator('#capture-list li')).toHaveCount(3);
  await expect(page.locator('#upload-state')).toContainText('Capturas guardadas');
  await expectImagesLoaded(page, 3);
  await expect.poll(() => uploadedStorageKeys.length).toBe(3);
  expect(new Set(uploadedStorageKeys).size).toBe(2);

  await page.reload();
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();
  await expect(page.locator('#capture-list li')).toHaveCount(3);
  await expectImagesLoaded(page, 3);

  await page.getByRole('button', { name: 'Ampliar camera.jpg' }).click();
  const preview = page.locator('#capture-preview-image');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: 'Cerrar vista previa' }).click();

  await expectNoHorizontalOverflow(page);
  expect(failures).toEqual([]);
});

test('a backend upload failure preserves the draft and succeeds on retry', async ({ page }) => {
  const failures = await gotoTickets(page, { allowExpectedUploadFailure: true });

  await page.locator('#receipt-camera').setInputFiles({
    name: 'existing.jpg',
    mimeType: 'image/jpeg',
    buffer: validJpeg,
  });
  await expect(page.locator('#capture-list li')).toHaveCount(1);

  let failNextUpload = true;
  await page.route('**/api/v1/files', async route => {
    if (route.request().method() === 'POST' && failNextUpload) {
      failNextUpload = false;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred. Reference: incident-upload-test',
            requestId: 'request-upload-test',
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  const retryFile = { name: 'retry.png', mimeType: 'image/png', buffer: validPng };
  await page.locator('#receipt-files').setInputFiles(retryFile);
  await expect(page.locator('#upload-state')).toContainText('Reference: incident-upload-test');
  await expect(page.locator('#capture-list li')).toHaveCount(1);
  await expect(page.locator('#capture-list')).toContainText('existing.jpg');

  await page.locator('#receipt-files').setInputFiles(retryFile);
  await expect(page.locator('#upload-state')).toContainText('Capturas guardadas');
  await expect(page.locator('#capture-list li')).toHaveCount(2);
  await expect(page.locator('#capture-list')).toContainText('existing.jpg');
  await expect(page.locator('#capture-list')).toContainText('retry.png');
  await expectImagesLoaded(page, 2);

  await expectNoHorizontalOverflow(page);
  expect(failures).toEqual([]);
});
