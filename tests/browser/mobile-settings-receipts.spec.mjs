import { test, expect } from '@playwright/test';

const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==', 'base64');

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

async function selectTaskTab(page, group, name) {
  await page.locator(`[data-tab-group="${group}"]`).getByRole('tab', { name, exact: true }).click();
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

function relativeLuminance([red, green, blue]) {
  const channels = [red, green, blue].map(value => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function parseRgb(value) {
  return value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
}

function contrastRatio(foreground, background) {
  const first = relativeLuminance(parseRgb(foreground));
  const second = relativeLuminance(parseRgb(background));
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

test('settings remain readable and unobscured across light and dark responsive layouts', async ({ page }, testInfo) => {
  const scenarios = [
    ['light', { width: 320, height: 700 }],
    ['dark', { width: 360, height: 780 }],
    ['light', { width: 390, height: 844 }],
    ['dark', { width: 430, height: 900 }],
    ['light', { width: 768, height: 1024 }],
  ];

  for (const [colorScheme, viewport] of scenarios) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme });
    await page.goto('/#home');
    await navigate(page, 'Ajustes');

    await expect(page.getByRole('heading', { name: 'Ajustes', exact: true })).toBeVisible();
    await expect(page.getByText('Sin inicio de sesión local')).toHaveCount(0);
    await expect(page.locator('[data-tab-group="settings"]')).toBeVisible();
    await expect(page.locator('[data-tab-group="settings"] [role="tab"][aria-selected="true"]')).toHaveText('General');
    await expect(page.getByRole('heading', { name: 'Servidor y versión' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Diagnóstico de IA' })).toBeHidden();
    await expect(page.locator('#ai-provider-network-note')).toBeHidden();
    await expectNoHorizontalOverflow(page);

    const metric = page.locator('[data-tab-panel="general"] .operations-metrics > div').first();
    const colors = await metric.evaluate(element => {
      const styles = getComputedStyle(element);
      return { foreground: styles.color, background: styles.backgroundColor };
    });
    expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);

    const lastMetric = page.locator('[data-tab-panel="general"] .operations-metrics > div').last();
    await lastMetric.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    const clearOfNavigation = await lastMetric.evaluate(element => {
      const metricRect = element.getBoundingClientRect();
      const navigation = document.querySelector('.bottom-nav')?.getBoundingClientRect();
      return navigation ? metricRect.bottom <= navigation.top - 8 : true;
    });
    expect(clearOfNavigation).toBeTruthy();

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`settings-${colorScheme}-${viewport.width}.png`),
      fullPage: false,
    });
  }
});

test('OCR exposes a two-slot per-image pipeline with retry and retailer autofill', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));

  let releaseBackgroundJob = () => {};
  const backgroundJobGate = new Promise(resolve => {
    releaseBackgroundJob = resolve;
  });
  await page.route('**/api/v1/receipts/extraction-jobs**', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.verifyWithAi).toBe(true);
      expect(body.captures).toHaveLength(3);
      await backgroundJobGate;
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ job: { id: 'receipt-job-pipeline' } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        job: { id: 'receipt-job-pipeline', status: 'completed', extraction: assembledExtraction() },
      }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-files').setInputFiles([0, 1, 2].map(index => ({
    name: `alcampo-${index + 1}.png`,
    mimeType: 'image/png',
    buffer: Buffer.concat([validPng, Buffer.from([index])]),
  })));
  await expect(page.locator('.capture-card')).toHaveCount(3);
  await selectTaskTab(page, 'tickets', 'Progreso');
  const aiInput = page.getByLabel('Verificar y normalizar con IA');
  const aiSwitch = page.locator('label.switch-row').filter({ has: aiInput });
  await aiSwitch.click();
  await expect(aiInput).toBeChecked();
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();

  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Preparando imagen' })).toHaveCount(3);
  await expect(page.locator('#receipt-progress-detail')).toContainText('3 procesando');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('background-job-running.png'), fullPage: false });

  releaseBackgroundJob();
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Completada' })).toHaveCount(3);
  await expect(page.locator('#receipt-state')).toContainText('88 artículos');
  await expect(page.locator('[data-tab-group="tickets"] [role="tab"][aria-selected="true"]')).toHaveText('Revisión');
  await expect(page.getByLabel('Comercio (opcional)', { exact: true })).toHaveValue('ALCAMPO ALMERIA');
  await expect(page.locator('#receipt-total')).toHaveValue('202.26');
  await expect(page.locator('.receipt-item')).toHaveCount(4);
  await expect(page.locator('.receipt-line-compact')).toHaveCount(4);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('retailer-confirmed.png'), fullPage: false });

  await selectTaskTab(page, 'tickets', 'Importar');
  const confirmationRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/receipts/confirm');
  await page.getByRole('button', { name: 'Confirmar e importar', exact: true }).click();
  const payload = (await confirmationRequest).postDataJSON();
  expect(payload.retailerName).toBe('ALCAMPO ALMERIA');
  expect(payload.declaredTotalMinor).toBe(20_226);
  expect(payload.ai.pages).toHaveLength(3);
  expect(payload.originalText).toContain('ALCAMPO ALMERIA');
  await expect(page.locator('#receipt-state')).toContainText('Ticket importado');
});

test('receipt cancellation stops queued work and preserves every capture', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  let started = 0;
  let releaseRequests = () => {};
  const requestGate = new Promise(resolve => {
    releaseRequests = resolve;
  });
  await page.route('**/api/v1/receipts/extract', async route => {
    started += 1;
    await requestGate;
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ extraction: pageExtraction(0, false) }),
      });
    } catch {
      // The expected AbortController cancellation closes intercepted requests.
    }
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-files').setInputFiles([0, 1, 2].map(index => ({
    name: `cancel-${index + 1}.png`,
    mimeType: 'image/png',
    buffer: Buffer.concat([validPng, Buffer.from([10 + index])]),
  })));
  await selectTaskTab(page, 'tickets', 'Progreso');
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect.poll(() => started).toBe(2);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'OCR local' })).toHaveCount(2);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Pendiente' })).toHaveCount(1);

  await selectTaskTab(page, 'tickets', 'Capturas');
  await page.locator('.capture-card').first().getByRole('button', { name: 'Cancelar esta imagen', exact: true }).click();
  await expect(page.locator('.capture-card').first().locator('.status-pill')).toHaveText('Cancelada');
  await expect.poll(() => started).toBe(3);

  await selectTaskTab(page, 'tickets', 'Progreso');
  await page.getByRole('button', { name: 'Cancelar todo', exact: true }).click();
  releaseRequests();
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Cancelada' })).toHaveCount(3);
  await expect(page.locator('.capture-card')).toHaveCount(3);
  await expect(page.locator('#receipt-progress-detail')).toContainText('3 canceladas');
  await expect(page.locator('#receipt-review')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Leer con OCR local', exact: true })).toBeEnabled();
  await expect(page.locator('#receipt-state')).toContainText('capturas, los OCR parciales y las páginas completadas se conservan');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('ocr-cancelled.png'), fullPage: false });
});

function withReview(items, extras = {}) {
  const expectedMinor = items.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  const declaredTotalMinor = extras.declaredTotalMinor ?? expectedMinor;
  return {
    ...extras,
    items,
    review: {
      lines: items.map(line => ({
        ...line,
        status: 'confirmed',
        expectedMinor: line.lineTotalMinor,
        differenceMinor: 0,
      })),
      total: {
        expectedMinor,
        differenceMinor: declaredTotalMinor - expectedMinor,
        valid: declaredTotalMinor === expectedMinor,
      },
    },
  };
}

function pageExtraction(index, verified) {
  const rawPages = [
    'ALCAMPO ALMERIA\n6 x ,89\nC.LADRON MANZAN 5,34 A\nPAN 1,50 B\nLECHE 1,20 B',
    'PAN 1,50 B\nLECHE 1,20 B\nRESTO TICKET 194,22 B',
    'RESTO TICKET 194,22 B\nTOT 202,26\nNUM. TOTAL ART. VENDIDOS = 88',
  ];
  const pageItems = [
    [item('C.LADRON MANZAN', 6, 89, 534, 'A'), item('PAN', 1, 150, 150, 'B'), item('LECHE', 1, 120, 120, 'B')],
    [item('PAN', 1, 150, 150, 'B'), item('LECHE', 1, 120, 120, 'B'), item('RESTO TICKET', 1, 19_422, 19_422, 'B')],
    [item('RESTO TICKET', 1, 19_422, 19_422, 'B')],
  ];
  const items = pageItems[index] || [];
  const final = withReview(items, {
    ...(index === 0 ? { retailerName: 'ALCAMPO ALMERIA' } : {}),
    ...(index === 2 ? { declaredTotalMinor: 20_226, articleCount: 88 } : {}),
  });
  return {
    pages: [{ pageIndex: 0, source: 'local-tesseract', rawText: rawPages[index], confidence: .92 }],
    deterministic: { ...final },
    final,
    originalText: rawPages[index],
    ...(verified ? {
      ai: {
        interpretation: {
          correctedText: rawPages[index],
          items,
          declaredTotalMinor: final.declaredTotalMinor,
          articleCount: final.articleCount,
          retailerName: final.retailerName,
          notes: [],
          confidence: .97,
        },
      },
    } : {}),
  };
}

function assembledExtraction() {
  const items = [
    item('C.LADRON MANZAN', 6, 89, 534, 'A'),
    item('PAN', 1, 150, 150, 'B'),
    item('LECHE', 1, 120, 120, 'B'),
    item('RESTO TICKET', 1, 19_422, 19_422, 'B'),
  ];
  const final = withReview(items, {
    declaredTotalMinor: 20_226,
    articleCount: 88,
    retailerName: 'ALCAMPO ALMERIA',
  });
  return {
    pages: [0, 1, 2].flatMap(index => pageExtraction(index, true).pages),
    deterministic: { ...final },
    final,
    originalText: [0, 1, 2].map(index => pageExtraction(index, true).originalText).join('\n'),
    ai: {
      interpretation: {
        correctedText: 'ALCAMPO ALMERIA\n6 x ,89\nC.LADRON MANZAN 5,34 A\nPAN 1,50 B\nLECHE 1,20 B\nRESTO TICKET 194,22 B\nTOT 202,26\nNUM. TOTAL ART. VENDIDOS = 88',
        items,
        declaredTotalMinor: 20_226,
        articleCount: 88,
        retailerName: 'ALCAMPO ALMERIA',
        notes: [],
        confidence: .97,
      },
    },
  };
}

function item(description, quantity, unitPriceMinor, lineTotalMinor, taxCategory) {
  return {
    description,
    quantity,
    unitPriceMinor,
    lineTotalMinor,
    taxCategory,
    sourceLines: [description],
    confidence: .95,
    status: 'confirmed',
  };
}
