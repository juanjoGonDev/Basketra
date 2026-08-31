import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);
const FILE_LIMIT = 512 * 1024 * 1024;

function capabilityBody(maxImageBytes) {
  return JSON.stringify({
    attachments: {
      maxCount: 10,
      maxFileBytes: FILE_LIMIT,
      maxImageBytes,
      maxSpreadsheetBytes: 50 * 1024 * 1024,
      maxUploadsPerThreeHours: 80,
    },
    execution: { replyInactivityTimeoutMs: 120_000 },
    requests: { maxJsonBodyBytes: 500 * 1024 * 1024 },
  });
}

async function installConfiguredAi(page, getImageLimit) {
  let reads = 0;
  await page.route('**/api/v1/settings/ai-provider', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true, baseUrl: 'http://webapi.test/v1/', model: 'default' }),
    });
  });
  await page.route('**/api/v1/ai/runtime-capabilities', async route => {
    reads += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: capabilityBody(getImageLimit()),
    });
  });
  return () => reads;
}

async function createList(page, name) {
  await page.locator('.bottom-nav').getByRole('button', { name: 'Listas', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva lista', exact: true }).click();
  const dialog = page.locator('#create-list-dialog');
  await dialog.getByLabel('Nombre', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Crear lista', exact: true }).click();
  await expect(page.locator('#active-list-title')).toHaveText(name);
}

test('product photos refresh the live WebAPI limit and never use Basketra metadata as AI policy', async ({ page }) => {
  let imageLimit = 2 * 1024 * 1024;
  const capabilityReads = await installConfiguredAi(page, () => imageLimit);
  let filePosts = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/files') filePosts += 1;
  });

  await page.goto('/');
  await expect(page.locator('#connection-state')).toContainText('Conectado');
  await createList(page, 'Live limits');
  await expect(page.locator('#product-image-limit-help')).toContainText('Límites actuales de WebAPI: imágenes 2 MB');
  const baselineReads = capabilityReads();

  await page.getByRole('button', { name: 'Añadir producto', exact: true }).click();
  imageLimit = 1024 * 1024;
  const oversizedBytes = imageLimit + imageLimit / 2;
  const oversizedPng = Buffer.concat([
    validPng,
    Buffer.alloc(oversizedBytes - validPng.byteLength),
  ]);
  await page.locator('#product-gallery').setInputFiles({
    name: 'too-large.png',
    mimeType: 'image/png',
    buffer: oversizedPng,
  });

  await expect(page.locator('#product-photo-state')).toContainText(
    'La imagen too-large.png ocupa 1,5 MB y supera el máximo de 1 MB admitido por WebAPI',
  );
  await expect(page.locator('#product-image-limit-help')).toContainText('Límites actuales de WebAPI: imágenes 1 MB');
  expect(capabilityReads()).toBeGreaterThan(baselineReads);
  expect(filePosts).toBe(0);
});

test('product photo upload fails closed when current WebAPI limits cannot be read', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true }) });
  });
  await page.route('**/api/v1/ai/runtime-capabilities', async route => {
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'AI_CAPABILITIES_UNAVAILABLE', message: 'WebAPI limits unavailable' } }),
    });
  });
  let filePosts = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/files') filePosts += 1;
  });

  await page.goto('/');
  await createList(page, 'Unavailable limits');
  await expect(page.locator('#product-image-limit-help')).toContainText('No se pudieron consultar los límites actuales de WebAPI');
  await page.getByRole('button', { name: 'Añadir producto', exact: true }).click();
  await page.locator('#product-gallery').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: validPng });

  await expect(page.locator('#product-photo-state')).toContainText('WebAPI limits unavailable');
  await expect(page.locator('#product-image-limit-help')).toContainText('No se pudieron consultar los límites actuales de WebAPI');
  expect(filePosts).toBe(0);
});

test('receipt upload keeps local OCR available while showing the live WebAPI image and file limits', async ({ page }) => {
  await installConfiguredAi(page, () => 1024 * 1024);
  await page.goto('/');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();

  const oversizedBytes = 1024 * 1024 + 512 * 1024;
  const oversizedPng = Buffer.concat([
    validPng,
    Buffer.alloc(oversizedBytes - validPng.byteLength),
  ]);
  await page.locator('#receipt-files').setInputFiles({
    name: 'receipt-large.png',
    mimeType: 'image/png',
    buffer: oversizedPng,
  });

  await expect(page.locator('#receipt-ai-limit-help')).toHaveText(
    'Límites actuales de WebAPI: imágenes 1 MB · PDF/archivos 512 MB.',
  );
  await expect(page.locator('#upload-state')).toContainText(
    'El archivo receipt-large.png ocupa 1,5 MB y supera el límite de 1 MB',
  );
  await expect(page.locator('#capture-list li')).toHaveCount(1);
});
