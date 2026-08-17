import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);
const minimalPdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

function receiptItem(description, lineTotalMinor) {
  return {
    description,
    quantity: 1,
    unitPriceMinor: lineTotalMinor,
    lineTotalMinor,
    confidence: 0.8,
    sourceLines: [1],
  };
}

function extraction(items = [receiptItem('PAN', 150)], options = {}) {
  const declaredTotalMinor = items.reduce((total, item) => total + item.lineTotalMinor, 0);
  const originalText = options.originalText ?? items
    .map(item => `${item.description} ${(item.lineTotalMinor / 100).toFixed(2)}`)
    .concat(`TOTAL ${(declaredTotalMinor / 100).toFixed(2)}`)
    .join('\n');
  return {
    pages: options.withPage === false ? [] : [{
      position: 0,
      source: 'local-tesseract',
      text: originalText,
      confidence: 0.8,
    }],
    originalText,
    deterministic: { items, declaredTotalMinor },
    final: {
      items,
      declaredTotalMinor,
      articleCount: items.length,
      warnings: [],
      review: {
        lines: items.map(item => ({
          ...item,
          status: 'confirmed',
          expectedMinor: item.lineTotalMinor,
          differenceMinor: 0,
        })),
        total: {
          expectedMinor: declaredTotalMinor,
          differenceMinor: 0,
          valid: true,
        },
      },
    },
  };
}

function emptyExtraction() {
  return {
    pages: [],
    originalText: '',
    deterministic: { items: [] },
    final: {
      items: [],
      warnings: [],
      review: {
        lines: [],
        total: { expectedMinor: 0, differenceMinor: 0, valid: true },
      },
    },
  };
}

async function enableAi(page) {
  const input = page.getByLabel('Verificar y normalizar con IA');
  await page.locator('label.switch-row').filter({ has: input }).click();
  await expect(input).toBeChecked();
}

async function uploadPng(page, name) {
  await page.locator('#receipt-files').setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: validPng,
  });
  await expect(page.locator('.capture-card')).toHaveCount(1);
}

test('an API failure without a stable code remains recoverable without inventing manual AI recovery', async ({ page }) => {
  await page.route('**/api/v1/receipts/extract', route => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: { message: 'Fallo de extracción sin código estable' } }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadPng(page, 'missing-code.png');
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();

  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');
  await expect(page.getByText('Fallo de extracción sin código estable', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reintentar imagen', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revisar manualmente', exact: true })).toHaveCount(0);
});

test('background AI failure keeps multiple captures retryable without manufacturing OCR rows', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs**', route => route.fulfill({
    status: route.request().method() === 'POST' ? 202 : 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: route.request().method() === 'POST'
        ? { id: 'background-ai-failure' }
        : { id: 'background-ai-failure', status: 'failed', errorCode: 'AI_UNREACHABLE' },
    }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadPng(page, 'plural-manual-review.png');
  await enableAi(page);
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');

  await expect(page.locator('#receipt-state')).toContainText('El análisis no terminó');
  await expect(page.getByRole('button', { name: 'Reintentar imagen', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revisar manualmente', exact: true })).toHaveCount(0);
  await expect(page.locator('.receipt-item')).toHaveCount(0);
});

test('a PDF provider failure permits blank manual entry while preserving the original capture', async ({ page }) => {
  let extractionCall = 0;
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  await page.route('**/api/v1/files', route => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({
      file: {
        mimeType: 'application/pdf',
        bytes: minimalPdf.length,
        storageKey: 'pdf-no-ocr',
        hash: 'a'.repeat(64),
      },
    }),
  }));
  await page.route('**/api/v1/receipts/extract', route => {
    extractionCall += 1;
    if (extractionCall === 1) {
      return route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'AI_PDF_CAPABILITY_UNAVAILABLE',
            message: 'private provider PDF detail',
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: emptyExtraction() }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-files').setInputFiles({
    name: 'ticket-without-ocr.pdf',
    mimeType: 'application/pdf',
    buffer: minimalPdf,
  });
  await expect(page.locator('.capture-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');

  await page.getByRole('button', { name: 'Revisar manualmente', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Revisión manual');
  await expect(page.getByText('Entrada manual pendiente; la captura original se conserva', { exact: true })).toBeVisible();
  await expect(page.locator('.capture-card')).toHaveCount(1);
  await expect(page.getByText('private provider PDF detail')).toHaveCount(0);
});

test('unknown page states and stale delegated actions fail closed without mutating captures', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const originalSet = Map.prototype.set;
    window.__injectUnknownReceiptPageStatus = false;
    Map.prototype.set = function set(key, value) {
      if (
        window.__injectUnknownReceiptPageStatus
        && value?.status === 'pending'
        && typeof value.version === 'number'
        && Object.hasOwn(value, 'rawText')
        && Object.hasOwn(value, 'recovery')
      ) {
        window.__injectUnknownReceiptPageStatus = false;
        value.status = 'future-status';
      }
      return originalSet.call(this, key, value);
    };
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.evaluate(() => { window.__injectUnknownReceiptPageStatus = true; });
  await uploadPng(page, 'future-status.png');

  const progress = page.locator('[data-capture-page-progress] [role="progressbar"]');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Pendiente');
  await expect(progress).toHaveAttribute('aria-valuenow', '0');

  await page.locator('#capture-list').evaluate(list => {
    for (const index of ['99', '0']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.captureAction = 'manual-review';
      button.dataset.captureIndex = index;
      button.textContent = `stale-${index}`;
      list.append(button);
    }
  });
  await page.getByRole('button', { name: 'stale-99', exact: true }).click();
  await page.getByRole('button', { name: 'stale-0', exact: true }).click();

  await expect(page.locator('.capture-card')).toHaveCount(1);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Pendiente');
  expect(pageErrors).toEqual([]);
});
