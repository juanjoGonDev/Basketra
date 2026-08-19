import { test, expect } from '@playwright/test';

const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==', 'base64');

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

test('a fresh OCR run ignores stale tasks that never settle after cancellation', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    let blockReceiptExtraction = true;
    window.__basketraAllowFreshReceiptExtraction = () => {
      blockReceiptExtraction = false;
    };
    window.fetch = (input, init) => {
      const address = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      const url = new URL(address, window.location.href);
      if (blockReceiptExtraction && url.pathname === '/api/v1/receipts/extract') {
        return new Promise(() => {});
      }
      return nativeFetch(input, init);
    };
  });

  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  let freshStarted = 0;
  let releaseFreshRequests = () => {};
  const freshGate = new Promise(resolve => {
    releaseFreshRequests = resolve;
  });
  await page.route('**/api/v1/receipts/extract', async route => {
    freshStarted += 1;
    await freshGate;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'TEST_STOP', message: 'test stop' } }),
    }).catch(() => {});
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-files').setInputFiles([0, 1, 2].map(index => ({
    name: `restart-${index + 1}.png`,
    mimeType: 'image/png',
    buffer: Buffer.concat([validPng, Buffer.from([30 + index])]),
  })));

  await expect(page.locator('.capture-card')).toHaveCount(3);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Lista' })).toHaveCount(3);
  await expect(page.locator('.capture-card__progress-meta').filter({ hasText: 'Lista para procesar' })).toHaveCount(3);

  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'OCR local' })).toHaveCount(2);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Pendiente' })).toHaveCount(1);

  await page.getByRole('button', { name: 'Cancelar todo', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Cancelada' })).toHaveCount(3);

  await page.evaluate(() => window.__basketraAllowFreshReceiptExtraction());
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();

  await expect.poll(() => freshStarted).toBe(2);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'OCR local' })).toHaveCount(2);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Pendiente' })).toHaveCount(1);
  await expect(page.locator('#receipt-progress-detail')).toContainText('2 procesando');
  await expect(page.locator('#receipt-progress-detail')).toContainText('1 pendientes');

  releaseFreshRequests();
});

test('a same-run retry waits for its cancelled task before reusing the capture slot', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    let blockFirstReceiptExtraction = true;
    let releaseBlockedRequest = null;
    window.__basketraReleaseCancelledReceipt = () => {
      blockFirstReceiptExtraction = false;
      releaseBlockedRequest?.(new Response(
        JSON.stringify({ error: { code: 'STALE_TEST_REQUEST', message: 'stale request released' } }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      ));
    };
    window.fetch = (input, init) => {
      const address = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      const url = new URL(address, window.location.href);
      if (blockFirstReceiptExtraction && url.pathname === '/api/v1/receipts/extract') {
        return new Promise(resolve => {
          releaseBlockedRequest = resolve;
        });
      }
      return nativeFetch(input, init);
    };
  });

  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  let retryStarted = 0;
  await page.route('**/api/v1/receipts/extract', route => {
    retryStarted += 1;
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'TEST_STOP', message: 'test stop' } }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-files').setInputFiles({
    name: 'same-run-retry.png',
    mimeType: 'image/png',
    buffer: validPng,
  });

  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('OCR local');
  await page.getByRole('button', { name: 'Cancelar esta imagen', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');

  await page.getByRole('button', { name: 'Reintentar imagen', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Pendiente');
  expect(retryStarted).toBe(0);

  await page.evaluate(() => window.__basketraReleaseCancelledReceipt());
  await expect.poll(() => retryStarted).toBe(1);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');
});
