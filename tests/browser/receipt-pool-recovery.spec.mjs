import { test, expect } from '@playwright/test';

const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==', 'base64');

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

async function upload(page, names) {
  await page.locator('#receipt-files').setInputFiles(names.map((name, index) => ({
    name,
    mimeType: 'image/png',
    buffer: Buffer.concat([validPng, Buffer.from([30 + index])]),
  })));
}

async function openCaptureDetails(page, index) {
  const details = page.locator('.capture-card__details').nth(index);
  if (!(await details.evaluate(element => element.open))) await details.locator('summary').click();
  return details;
}

test('per-image retries ignore stale tasks from a cancelled automatic OCR run', async ({ page }) => {
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
  await upload(page, ['restart-1.png', 'restart-2.png', 'restart-3.png']);

  await expect(page.locator('.capture-card')).toHaveCount(3);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'OCR local' })).toHaveCount(2);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Pendiente' })).toHaveCount(1);

  await page.getByRole('button', { name: 'Cancelar procesamiento', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Cancelada' })).toHaveCount(3);

  await page.evaluate(() => window.__basketraAllowFreshReceiptExtraction());
  for (const index of [0, 1]) {
    const details = await openCaptureDetails(page, index);
    await details.getByRole('button', { name: 'Reintentar imagen', exact: true }).click();
  }

  await expect.poll(() => freshStarted).toBe(2);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'OCR local' })).toHaveCount(2);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Cancelada' })).toHaveCount(1);
  await expect(page.locator('#receipt-progress-detail')).toContainText('2 procesando');

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
  await upload(page, ['same-run-retry.png']);

  await expect(page.locator('.capture-card .status-pill')).toHaveText('OCR local');
  let details = await openCaptureDetails(page, 0);
  await details.getByRole('button', { name: 'Cancelar esta imagen', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');

  details = await openCaptureDetails(page, 0);
  await details.getByRole('button', { name: 'Reintentar imagen', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Pendiente');
  expect(retryStarted).toBe(0);

  await page.evaluate(() => window.__basketraReleaseCancelledReceipt());
  await expect.poll(() => retryStarted).toBe(1);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');
});
