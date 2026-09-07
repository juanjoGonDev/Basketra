import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

function ocrEvidence(description = 'PAN INTEGRAL', lineTotalMinor = 165) {
  return {
    text: `${description} 1,65`,
    confidence: 0.92,
    source: 'local-tesseract',
    deterministic: {
      metadata: {},
      items: [{
        description,
        quantity: 1,
        unitPriceMinor: lineTotalMinor,
        lineTotalMinor,
        confidence: 0.92,
        sourceLines: [1],
      }],
    },
  };
}

function completedExtraction(description = 'PAN INTEGRAL', lineTotalMinor = 165) {
  const item = {
    description,
    quantity: 1,
    unitPriceMinor: lineTotalMinor,
    lineTotalMinor,
    confidence: 0.92,
    sourceLines: [1],
  };
  return {
    pages: [{
      position: 0,
      source: 'local-tesseract',
      text: `${description} 1,65`,
      confidence: 0.92,
    }],
    originalText: `${description} 1,65`,
    deterministic: {
      items: [item],
      declaredTotalMinor: lineTotalMinor,
    },
    final: {
      items: [item],
      declaredTotalMinor: lineTotalMinor,
      warnings: [],
      review: {
        lines: [{
          ...item,
          status: 'confirmed',
          expectedMinor: lineTotalMinor,
          differenceMinor: 0,
        }],
        total: {
          expectedMinor: lineTotalMinor,
          differenceMinor: 0,
          valid: true,
        },
      },
    },
  };
}

test('receipt analysis is minimal, mobile-first and exposes one three-path floating add action', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  for (const viewport of [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await navigate(page, 'Tickets');

    await expect(page.getByRole('heading', { name: 'Análisis de ticket', exact: true })).toBeVisible();

    const queue = page.locator('#receipt-source-queue');
    await expect(queue).toBeVisible();
    await expect(queue).not.toHaveAttribute('open', '');
    await expect(queue.locator(':scope > summary')).toContainText('0 archivos');

    const add = page.getByRole('button', { name: 'Añadir al ticket', exact: true });
    await expect(add).toBeVisible();
    await add.click();

    const dial = page.locator('#receipt-add-menu');
    await expect(dial).toBeVisible();
    await expect(dial.getByText('IA', { exact: true })).toBeVisible();
    await expect(dial.getByText('Manual', { exact: true })).toBeVisible();
    await expect(dial.getByText('Scan', { exact: true })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dial).toBeHidden();
    await expectNoHorizontalOverflow(page);
  }
});

test('durable OCR evidence appears progressively in the body while source details stay in the queue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));

  const jobId = 'receiptextractionjob_minimalui';
  const progress = {
    pages: [{
      position: 0,
      stage: 'ai',
      ocr: ocrEvidence(),
    }],
  };

  await page.route('**/api/v1/receipts/extraction-jobs', route => route.fulfill({
    status: 202,
    contentType: 'application/json',
    body: JSON.stringify({
      job: {
        id: jobId,
        status: 'running',
        progress,
      },
    }),
  }));
  await page.route(`**/api/v1/receipts/extraction-jobs/${jobId}`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      job: {
        id: jobId,
        status: 'running',
        progress,
      },
    }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-files').setInputFiles({
    name: 'ticket-progress.png',
    mimeType: 'image/png',
    buffer: validPng,
  });

  await expect(page.locator('#receipt-detected-list')).toContainText('PAN INTEGRAL');
  await expect(page.locator('#receipt-detected-count')).toContainText('1');
  await expect(page.locator('#receipt-progress')).toBeVisible();

  const queue = page.locator('#receipt-source-queue');
  await expect(queue.locator(':scope > summary')).toContainText('1 archivo');
  await queue.locator(':scope > summary').click();
  await expect(queue).toHaveAttribute('open', '');
  await expect(queue.locator('.capture-card')).toHaveCount(1);
  await expect(queue.locator('.capture-card .status-pill')).toContainText('Verificando con IA');

  await expect(page.locator('#receipt-review-panel')).toBeHidden();
  await expectNoHorizontalOverflow(page);
});

test('queue cancel-all preserves uploaded captures and marks active work cancelled', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  let releaseOcr = () => {};
  const gate = new Promise(resolve => { releaseOcr = resolve; });
  await page.route('**/api/v1/receipts/extract', async route => {
    await gate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: completedExtraction() }),
    }).catch(() => {});
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-files').setInputFiles({
    name: 'cancel-me.png',
    mimeType: 'image/png',
    buffer: validPng,
  });

  const queue = page.locator('#receipt-source-queue');
  await queue.locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Cancelar todo el análisis', exact: true }).click();
  releaseOcr();

  await expect(page.locator('.capture-card')).toHaveCount(1);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Cancelada');
  await expect(page.locator('#receipt-review')).toBeHidden();
  await expect(page.locator('#receipt-state')).toContainText('se conservan');
  await expectNoHorizontalOverflow(page);
});

test('manual floating action opens the existing review editor and focuses the new line', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.getByRole('button', { name: 'Añadir al ticket', exact: true }).click();
  await page.locator('#receipt-add-menu').getByRole('button', { name: 'Manual', exact: true }).click();

  const reviewPanel = page.locator('#receipt-review-panel');
  await expect(reviewPanel).toBeVisible();
  await expect(reviewPanel).toHaveAttribute('open', '');
  await expect(page.locator('.receipt-item')).toHaveCount(1);

  const description = page.locator('.receipt-item').first().locator('[data-field="description"]');
  await expect(description).toBeFocused();
  await expect(page.locator('#receipt-add-menu')).toBeHidden();
  await expectNoHorizontalOverflow(page);
});
