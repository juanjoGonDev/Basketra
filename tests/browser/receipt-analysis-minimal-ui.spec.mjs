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

test('receipt analysis is minimal, responsive and exposes one three-path floating add action', async ({ page }, testInfo) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  for (const viewport of [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1280, height: 900 },
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
    await expect(page.locator('#receipt-analysis-options')).toHaveCount(0);
    await expect(page.locator('#verify-receipt-ai')).toHaveCount(0);

    if (viewport.width === 390 || viewport.width === 1280) {
      await page.screenshot({
        path: testInfo.outputPath(`receipt-add-menu-${viewport.width}.png`),
        fullPage: true,
      });
    }

    await page.keyboard.press('Escape');
    await expect(dial).toBeHidden();

    await queue.locator(':scope > summary').click();
    await expect(queue).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(queue).not.toHaveAttribute('open', '');
    await expect(page.locator('#receipt-state')).not.toContainText('Análisis cancelado');

    if (viewport.width === 390) {
      await add.click();
      await expect(dial).toBeVisible();
      await navigate(page, 'Inicio');
      await navigate(page, 'Tickets');
      await expect(dial).toBeHidden();
    }

    await expectNoHorizontalOverflow(page);
  }
});

test('durable OCR evidence appears progressively in the body while source details stay in the queue', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  await page.route('**/api/v1/ai/runtime-capabilities', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      attachments: {
        maxImageBytes: 20 * 1024 * 1024,
        maxFileBytes: 512 * 1024 * 1024,
      },
    }),
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
  await page.screenshot({
    path: testInfo.outputPath('receipt-progressive-queue-390.png'),
    fullPage: true,
  });

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

test('manual floating action uses a cancellable modal without fake capture preview', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  await page.goto('/');
  await navigate(page, 'Tickets');
  const add = page.getByRole('button', { name: 'Añadir al ticket', exact: true });
  await add.click();
  await page.locator('#receipt-add-manual').click();

  const reviewPanel = page.locator('#receipt-review-panel');
  const dialog = page.locator('#receipt-line-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Añadir producto', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Eliminar', exact: true })).toBeHidden();
  await expect(dialog.locator('[data-field="description"]')).toBeFocused();
  await expect(reviewPanel).not.toHaveAttribute('open', '');
  await expect(page.locator('.receipt-review-evidence')).toBeHidden();
  await expect(page.locator('#receipt-review-panel-title')).toHaveText('Revisión y validación');
  await expect(page.locator('#receipt-add-menu')).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath('receipt-manual-modal-390.png'),
    fullPage: true,
  });

  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.receipt-item')).toHaveCount(0);
  await expect(reviewPanel).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath('receipt-manual-cancelled-390.png'),
    fullPage: true,
  });

  await add.click();
  await page.locator('#receipt-add-manual').click();
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-field="description"]').fill('PAN MANUAL');
  await dialog.getByRole('button', { name: 'Guardar línea', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#receipt-detected-list')).toContainText('PAN MANUAL');
  await expect(reviewPanel).toBeVisible();
  await expect(reviewPanel).not.toHaveAttribute('open', '');
  await expect(page.locator('.receipt-review-evidence')).toBeHidden();
  await expectNoHorizontalOverflow(page);
});
