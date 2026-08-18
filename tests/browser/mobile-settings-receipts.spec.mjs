import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);

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

test('settings remain readable and reserve space for compact navigation across responsive layouts', async ({ page }, testInfo) => {
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

    const reservedSpace = await page.locator('[data-view="settings"]')
      .evaluate((settings, expectedGap) => {
        const navigation = document.querySelector('.bottom-nav');
        if (!navigation) return { enough: true, padding: 0, required: 0 };
        const navigationRect = navigation.getBoundingClientRect();
        const isBottomNavigation = navigationRect.width > navigationRect.height * 2;
        if (!isBottomNavigation) return { enough: true, padding: 0, required: 0 };
        const padding = Number.parseFloat(getComputedStyle(settings).paddingBottom);
        const required = navigationRect.height + expectedGap;
        return { enough: padding >= required, padding, required };
      }, 8);
    expect(reservedSpace.enough, `settings bottom padding ${reservedSpace.padding}px must clear ${reservedSpace.required}px navigation`).toBeTruthy();

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`settings-${colorScheme}-${viewport.width}.png`),
      fullPage: false,
    });
  }
});

test('automatic OCR and AI pipeline exposes live progress and retailer-confirmed review', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));
  await page.route('**/api/v1/receipts/extract', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ extraction: assembledExtraction() }),
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
        job: {
          id: 'receipt-job-pipeline',
          status: 'completed',
          extraction: backgroundJobExtraction(),
        },
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
  await expect(page.getByRole('tab', { name: 'Progreso', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Leer con OCR local', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Verificar y normalizar con IA')).toHaveCount(0);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'En cola' })).toHaveCount(3);
  await expect(page.locator('#receipt-progress-detail')).toContainText('3 pendientes');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('automatic-pipeline-queued.png'), fullPage: false });

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

test('receipt cancellation requeues surviving captures and cancel-all preserves the draft', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false }),
  }));

  let jobCounter = 0;
  let deleteRequests = 0;
  await page.route('**/api/v1/receipts/extraction-jobs**', route => {
    const method = route.request().method();
    if (method === 'DELETE') {
      deleteRequests += 1;
      return route.fulfill({ status: 204 });
    }
    if (method === 'POST') {
      jobCounter += 1;
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ job: { id: `receipt-job-cancel-${jobCounter}` } }),
      });
    }
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id, status: 'running' } }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-files').setInputFiles([0, 1, 2].map(index => ({
    name: `cancel-${index + 1}.png`,
    mimeType: 'image/png',
    buffer: Buffer.concat([validPng, Buffer.from([10 + index])]),
  })));

  await expect(page.locator('.capture-card')).toHaveCount(3);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Procesando' })).toHaveCount(3);
  await page.locator('.capture-card').first().getByRole('button', { name: 'Cancelar esta imagen', exact: true }).click();
  await expect(page.locator('.capture-card').first().locator('.status-pill')).toHaveText('Cancelada');
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Procesando' })).toHaveCount(2);
  await expect.poll(() => jobCounter).toBe(2);
  expect(deleteRequests).toBe(1);

  await page.getByRole('button', { name: 'Cancelar todo', exact: true }).click();
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Cancelada' })).toHaveCount(3);
  await expect(page.locator('.capture-card')).toHaveCount(3);
  await expect(page.locator('#receipt-progress-detail')).toContainText('3 canceladas');
  await expect(page.locator('#receipt-review')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Leer con OCR local', exact: true })).toHaveCount(0);
  await expect(page.locator('#receipt-state')).toContainText('Las capturas y cualquier OCR completado se conservan');
  await expect.poll(() => deleteRequests).toBe(2);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('automatic-processing-cancelled.png'), fullPage: false });
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

function pageEvidence(index) {
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
  const metadata = {
    ...(index === 0 ? { retailerName: 'ALCAMPO ALMERIA' } : {}),
    ...(index === 2 ? { declaredTotalMinor: 20_226, articleCount: 88 } : {}),
  };
  return {
    position: index,
    storageKey: `evidence-${index}`,
    source: 'local-tesseract',
    text: rawPages[index],
    confidence: .92,
    deterministic: { items: pageItems[index], metadata },
    ai: {
      attempts: 1,
      interpretation: {
        correctedText: rawPages[index],
        items: pageItems[index],
        ...metadata,
        notes: [],
        confidence: .97,
      },
    },
  };
}

function backgroundJobExtraction() {
  const pages = [0, 1, 2].map(pageEvidence);
  return {
    pages,
    originalText: pages.map(page => page.text).join('\n'),
    deterministic: { items: pages.flatMap(page => page.deterministic.items) },
    final: withReview(pages.flatMap(page => page.deterministic.items)),
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
    pages: [0, 1, 2].map(pageEvidence),
    deterministic: { ...final },
    final,
    originalText: [0, 1, 2].map(index => pageEvidence(index).text).join('\n'),
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
