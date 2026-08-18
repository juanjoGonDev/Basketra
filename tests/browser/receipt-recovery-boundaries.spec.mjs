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

test('an automatic job submission failure remains recoverable without inventing manual AI recovery', async ({ page }) => {
  await page.route('**/api/v1/receipts/extraction-jobs', route => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: { message: 'Fallo de extracción sin código estable' } }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadPng(page, 'missing-code.png');

  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');
  await expect(page.locator('#receipt-state')).toContainText('procesamiento automático no terminó');
  await expect(page.getByRole('button', { name: 'Reintentar imagen', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revisar manualmente', exact: true })).toHaveCount(0);
});

test('background AI failure keeps the capture retryable without manufacturing OCR rows', async ({ page }) => {
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
        ? { id: 'receiptextractionjob_backgroundfailure' }
        : { id: 'receiptextractionjob_backgroundfailure', status: 'failed', errorCode: 'AI_UNREACHABLE' },
    }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadPng(page, 'plural-manual-review.png');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');

  await expect(page.locator('#receipt-state')).toContainText('procesamiento automático no terminó');
  await expect(page.getByRole('button', { name: 'Reintentar imagen', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revisar manualmente', exact: true })).toHaveCount(0);
  await expect(page.locator('.receipt-item')).toHaveCount(0);
});

test('a PDF provider failure permits blank manual entry while preserving the original capture', async ({ page }) => {
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
        storageKey: 'a'.repeat(64) + '.pdf',
        hash: 'a'.repeat(64),
      },
    }),
  }));
  await page.route('**/api/v1/receipts/extraction-jobs**', route => route.fulfill({
    status: route.request().method() === 'POST' ? 202 : 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: route.request().method() === 'POST'
        ? { id: 'receiptextractionjob_pdfrecovery' }
        : { id: 'receiptextractionjob_pdfrecovery', status: 'failed', errorCode: 'AI_PDF_CAPABILITY_UNAVAILABLE' },
    }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-files').setInputFiles({
    name: 'ticket-without-ocr.pdf',
    mimeType: 'application/pdf',
    buffer: minimalPdf,
  });
  await expect(page.locator('.capture-card')).toHaveCount(1);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');

  await page.getByRole('button', { name: 'Revisar manualmente', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Revisión manual');
  await expect(page.getByText('Entrada manual pendiente; la captura original se conserva', { exact: true })).toBeVisible();
  await expect(page.locator('.capture-card')).toHaveCount(1);
  await expect(page.getByText('private provider PDF detail')).toHaveCount(0);
});

test('stale delegated recovery actions fail closed without mutating an automatically queued capture', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/v1/receipts/extraction-jobs**', route => route.fulfill({
    status: route.request().method() === 'POST' ? 202 : 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: route.request().method() === 'POST'
        ? { id: 'receiptextractionjob_staleaction' }
        : { id: 'receiptextractionjob_staleaction', status: 'queued' },
    }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await uploadPng(page, 'future-status.png');

  const progress = page.locator('[data-capture-page-progress] [role="progressbar"]');
  await expect(page.locator('.capture-card .status-pill')).toHaveText('En cola');
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
  await expect(page.locator('.capture-card .status-pill')).toHaveText('En cola');
  expect(pageErrors).toEqual([]);
});
