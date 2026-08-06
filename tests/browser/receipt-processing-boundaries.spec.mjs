import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

function item() {
  return {
    description: 'PAN',
    quantity: 1,
    unitPriceMinor: 150,
    lineTotalMinor: 150,
    confidence: 0.8,
    sourceLines: [1],
  };
}

function extraction() {
  const line = item();
  return {
    pages: [{
      position: 0,
      source: 'local-tesseract',
      text: 'PAN 1,50\nTOTAL 1,50',
      confidence: 0.8,
    }],
    originalText: 'PAN 1,50\nTOTAL 1,50',
    deterministic: {
      items: [line],
      declaredTotalMinor: 150,
    },
    final: {
      items: [line],
      declaredTotalMinor: 150,
      warnings: [],
      review: {
        lines: [{
          ...line,
          status: 'confirmed',
          expectedMinor: 150,
          differenceMinor: 0,
        }],
        total: {
          expectedMinor: 150,
          differenceMinor: 0,
          valid: true,
        },
      },
    },
  };
}

async function uploadReceipt(page, name) {
  await page.locator('#receipt-files').setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: validPng,
  });
  await expect(page.locator('.capture-card')).toHaveCount(1);
}

test('an AbortError marks the page cancelled without converting it into an AI or OCR failure', async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.__abortNextReceiptExtraction = false;
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (window.__abortNextReceiptExtraction && url.pathname === '/api/v1/receipts/extract') {
        window.__abortNextReceiptExtraction = false;
        return Promise.reject(new DOMException('cancelled by boundary test', 'AbortError'));
      }
      return originalFetch(input, init);
    };
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'abort-boundary.png');
  await page.evaluate(() => { window.__abortNextReceiptExtraction = true; });
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();

  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');
  await expect(page.locator('#receipt-state')).toContainText('0 imágenes con error y 1 canceladas');
  await expect(page.getByText('Revisar manualmente', { exact: true })).toHaveCount(0);
});

test('assembly failure preserves completed pages and defensive confirmation remains blocked', async ({ page }) => {
  await page.route('**/api/v1/receipts/extract', route => {
    const body = route.request().postDataJSON();
    const assembled = typeof body.captures?.[0]?.embeddedText === 'string';
    if (assembled) {
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'AI_PROVIDER_FAILED',
            message: 'No se pudo combinar el borrador',
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: extraction() }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#confirm-receipt').evaluate(element => element.click());
  await expect(page.locator('#receipt-state')).toHaveText('Completa, reintenta o retira todas las imágenes antes de confirmar el ticket.');

  await uploadReceipt(page, 'assembly-boundary.png');
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Completada');
  await expect(page.locator('#receipt-state')).toContainText('No se pudo combinar el borrador');
  await expect(page.locator('#receipt-state')).toContainText('Las páginas completadas se conservan');
  await expect(page.getByRole('button', { name: 'Leer con OCR local', exact: true })).toBeEnabled();

  await page.locator('#confirm-receipt').evaluate(element => element.click());
  await expect(page.locator('#receipt-state')).toHaveText('No hay líneas para importar.');
});

test('cancel all marks active work cancelled and keeps the uploaded capture', async ({ page }) => {
  let releaseRequest = () => {};
  const requestGate = new Promise(resolve => { releaseRequest = resolve; });
  await page.route('**/api/v1/receipts/extract', async route => {
    await requestGate;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: extraction() }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadReceipt(page, 'cancel-all.png');
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('OCR local');
  await page.getByRole('button', { name: 'Cancelar todo', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');
  await expect(page.locator('#receipt-state')).toContainText('Análisis cancelado');
  await expect(page.locator('.capture-card')).toHaveCount(1);
  releaseRequest();
});
