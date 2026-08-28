import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);
const minimalPdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

async function uploadPng(page, name) {
  await page.locator('#receipt-files').setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: validPng,
  });
  await expect(page.locator('.capture-card')).toHaveCount(1);
}

async function openCaptureDetails(page) {
  const details = page.locator('.capture-card__details').first();
  if (!(await details.evaluate(element => element.open))) await details.locator('summary').click();
  return details;
}

test('an OCR API failure without a stable code remains retryable without inventing AI recovery', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));
  await page.route('**/api/v1/receipts/extract', route => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: { message: 'Fallo de extracción sin código estable' } }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadPng(page, 'missing-code.png');

  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');
  const details = await openCaptureDetails(page);
  await expect(details.getByText('Fallo de extracción sin código estable', { exact: false })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Reintentar imagen', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Volver a analizar con IA', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revisar manualmente', exact: true })).toHaveCount(0);
});

test('a durable PDF provider failure permits blank manual entry while preserving the original capture', async ({ page }) => {
  let extractionCall = 0;
  const jobId = 'receiptextractionjob_pdfmanual';
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
  await page.route('**/api/v1/receipts/extraction-jobs', route => route.fulfill({
    status: 202,
    contentType: 'application/json',
    body: JSON.stringify({ job: { id: jobId, status: 'queued' } }),
  }));
  await page.route(`**/api/v1/receipts/extraction-jobs/${jobId}`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: { id: jobId, status: 'failed', errorCode: 'AI_PDF_CAPABILITY_UNAVAILABLE' },
    }),
  }));
  await page.route('**/api/v1/receipts/extract', route => {
    extractionCall += 1;
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
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');
  expect(extractionCall).toBe(0);

  const details = await openCaptureDetails(page);
  await details.getByRole('button', { name: 'Revisar manualmente', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Revisión manual');
  await expect(page.getByText('Entrada manual pendiente; la captura original se conserva', { exact: true })).toBeVisible();
  await expect(page.locator('.capture-card')).toHaveCount(1);
  await expect(page.getByText('private provider PDF detail')).toHaveCount(0);
  await expect(page.locator('#receipt-review-panel')).toHaveAttribute('open', '');
  await expect(page.locator('#receipt-review-reference')).toContainText('ticket-without-ocr.pdf');
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
        && value?.status === 'ready'
        && typeof value.version === 'number'
        && Object.hasOwn(value, 'rawText')
        && Object.hasOwn(value, 'recovery')
      ) {
        value.status = 'future-status';
      }
      return originalSet.call(this, key, value);
    };
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.evaluate(() => { window.__injectUnknownReceiptPageStatus = true; });
  await uploadPng(page, 'future-status.png');
  await page.evaluate(() => { window.__injectUnknownReceiptPageStatus = false; });

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
