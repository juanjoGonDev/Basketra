import { test, expect } from '@playwright/test';

const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==', 'base64');

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
    await expect(page.getByRole('heading', { name: 'Servidor y versión' })).toBeVisible();
    await expect(page.locator('#ai-provider-network-note')).toBeHidden();
    await expectNoHorizontalOverflow(page);

    const metric = page.locator('.operations-metrics > div').first();
    const colors = await metric.evaluate(element => {
      const styles = getComputedStyle(element);
      return { foreground: styles.color, background: styles.backgroundColor };
    });
    expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);

    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    const clearance = await page.locator('.operations-card').last().evaluate(element => {
      const card = element.getBoundingClientRect();
      const navigation = document.querySelector('.bottom-nav')?.getBoundingClientRect();
      return navigation ? navigation.top - card.bottom : 1;
    });
    expect(clearance).toBeGreaterThanOrEqual(8);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`settings-${colorScheme}-${viewport.width}.png`),
      fullPage: true,
    });
  }
});

test('automatic OCR and optional AI correction preserve the two-slot pool and retailer autofill', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));

  let activeOcr = 0;
  let maximumActiveOcr = 0;
  let createdAiJobs = 0;
  const aiJobIndexes = new Map();
  await page.route('**/api/v1/receipts/extract', async route => {
    const body = route.request().postDataJSON();
    const captures = body.captures ?? [];
    const single = captures.length === 1;
    const embeddedText = single && typeof captures[0].embeddedText === 'string';
    const match = /alcampo-(\d+)\.png/u.exec(captures[0]?.originalName ?? '');
    const index = match ? Number(match[1]) - 1 : 0;

    if (single && body.verifyWithAi === false && !embeddedText) {
      activeOcr += 1;
      maximumActiveOcr = Math.max(maximumActiveOcr, activeOcr);
      await new Promise(resolve => setTimeout(resolve, 80));
      activeOcr -= 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ extraction: pageExtraction(index, false) }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ extraction: assembledExtraction() }),
    });
  });
  await page.route('**/api/v1/receipts/extraction-jobs', async route => {
    const body = route.request().postDataJSON();
    const capture = body.captures?.[0];
    const match = /alcampo-(\d+)\.png/u.exec(capture?.originalName ?? '');
    const index = match ? Number(match[1]) - 1 : 0;
    expect(body.verifyWithAi).toBe(true);
    expect(capture?.embeddedText).toBe(pageExtraction(index, false).originalText);
    const id = `receipt_ai_${index}`;
    aiJobIndexes.set(id, index);
    createdAiJobs += 1;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id, status: 'queued' } }),
    });
  });
  await page.route('**/api/v1/receipts/extraction-jobs/*', async route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    const index = aiJobIndexes.get(id);
    expect(index).not.toBeUndefined();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        job: { id, status: 'completed', extraction: pageExtraction(index, true) },
      }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await expect(page.getByRole('button', { name: 'Leer con OCR local', exact: true })).toHaveCount(0);
  await expect(page.locator('#receipt-analysis-options')).not.toHaveAttribute('open', '');
  await expect(page.locator('#verify-receipt-ai')).toBeChecked();

  await page.locator('#receipt-files').setInputFiles([0, 1, 2].map(index => ({
    name: `alcampo-${index + 1}.png`,
    mimeType: 'image/png',
    buffer: Buffer.concat([validPng, Buffer.from([index])]),
  })));

  await expect(page.locator('.capture-card')).toHaveCount(3);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Completada' })).toHaveCount(3);
  expect(maximumActiveOcr).toBe(2);
  expect(createdAiJobs).toBe(3);
  await expect(page.locator('#receipt-state')).toContainText('88 artículos');
  await expect(page.getByLabel('Comercio (opcional)', { exact: true })).toHaveValue('ALCAMPO ALMERIA');
  await expect(page.locator('#receipt-total')).toHaveValue('202.26');
  await expect(page.locator('.receipt-item')).toHaveCount(4);
  await expect(page.locator('#receipt-review-panel')).toHaveAttribute('open', '');
  await expect(page.locator('#receipt-review-reference-image')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('retailer-confirmed.png'), fullPage: true });

  const confirmationRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/receipts/confirm');
  await page.locator('#confirm-receipt').click();
  const payload = (await confirmationRequest).postDataJSON();
  expect(payload.retailerName).toBe('ALCAMPO ALMERIA');
  expect(payload.declaredTotalMinor).toBe(20_226);
  expect(payload.ai.pages).toHaveLength(3);
  expect(payload.originalText).toContain('ALCAMPO ALMERIA');
  await expect(page.locator('#receipt-state')).toContainText('Ticket importado');
});

test('receipt cancellation stops queued automatic work and preserves every capture', async ({ page }, testInfo) => {
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

  await expect.poll(() => started).toBe(2);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'OCR local' })).toHaveCount(2);
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Pendiente' })).toHaveCount(1);

  const firstDetails = page.locator('.capture-card__details').first();
  await expect(firstDetails).not.toHaveAttribute('open', '');
  await firstDetails.locator('summary').click();
  await expect(firstDetails).toHaveAttribute('open', '');
  await firstDetails.getByRole('button', { name: 'Cancelar esta imagen', exact: true }).click();
  await expect(page.locator('.capture-card').first().locator('.status-pill')).toHaveText('Cancelada');
  await expect.poll(() => started).toBe(3);

  await page.getByRole('button', { name: 'Cancelar procesamiento', exact: true }).click();
  releaseRequests();
  await expect(page.locator('.capture-card .status-pill').filter({ hasText: 'Cancelada' })).toHaveCount(3);
  await expect(page.locator('.capture-card')).toHaveCount(3);
  await expect(page.locator('#receipt-progress-detail')).toContainText('3 canceladas');
  await expect(page.locator('#receipt-review')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Leer con OCR local', exact: true })).toHaveCount(0);
  await expect(page.locator('#receipt-state')).toContainText('capturas, los OCR parciales y las páginas completadas se conservan');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('ocr-cancelled.png'), fullPage: true });
});

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
  const final = {
    items,
    ...(index === 0 ? { retailerName: 'ALCAMPO ALMERIA' } : {}),
    ...(index === 2 ? { declaredTotalMinor: 20_226, articleCount: 88 } : {}),
    warnings: [],
    review: review(items, index === 2 ? 20_226 : undefined),
  };
  return {
    pages: [{ position: 0, source: verified ? 'embedded-text' : 'local-tesseract', text: rawPages[index], confidence: 0.91 }],
    originalText: rawPages[index],
    deterministic: { items },
    ...(verified ? {
      ai: {
        interpretation: {
          ...(final.retailerName ? { retailerName: final.retailerName } : {}),
          ...(final.declaredTotalMinor === undefined ? {} : { declaredTotalMinor: final.declaredTotalMinor }),
          ...(final.articleCount === undefined ? {} : { articleCount: final.articleCount }),
          currency: 'EUR',
          correctedText: rawPages[index],
          items,
          warnings: [],
        },
        attempts: 1,
        pages: [],
      },
    } : {}),
    final,
  };
}

function assembledExtraction() {
  const items = [
    item('C.LADRON MANZAN', 6, 89, 534, 'A'),
    item('PAN', 1, 150, 150, 'B'),
    item('LECHE', 1, 120, 120, 'B'),
    item('RESTO TICKET', 1, 19_422, 19_422, 'B'),
  ];
  return {
    pages: [0, 1, 2].map(position => ({
      position,
      source: 'local-tesseract',
      text: `OCR page ${position + 1}`,
      confidence: 0.91,
    })),
    originalText: 'ALCAMPO ALMERIA\nC.LADRON MANZAN;6;89;534;A\nPAN;1;150;150;B\nLECHE;1;120;120;B\nRESTO TICKET;1;19422;19422;B\nTOTAL 202.26\nNUM. TOTAL ART. VENDIDOS = 88',
    deterministic: {
      retailerName: 'ALCAMPO ALMERIA',
      declaredTotalMinor: 20_226,
      articleCount: 88,
      items,
    },
    ai: {
      interpretation: {
        retailerName: 'ALCAMPO ALMERIA',
        declaredTotalMinor: 20_226,
        articleCount: 88,
        currency: 'EUR',
        correctedText: 'ALCAMPO ALMERIA\nTOTAL 202.26',
        items,
        warnings: [],
      },
      attempts: 1,
      pages: [0, 1, 2].map(position => ({
        position,
        interpretation: {
          currency: 'EUR',
          correctedText: `OCR page ${position + 1}`,
          items: [],
          warnings: [],
        },
        attempts: 1,
      })),
    },
    final: {
      retailerName: 'ALCAMPO ALMERIA',
      declaredTotalMinor: 20_226,
      articleCount: 88,
      items,
      warnings: [],
      review: review(items, 20_226),
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
    confidence: 0.95,
    sourceLines: [1],
  };
}

function review(items, declaredTotalMinor) {
  const expectedMinor = items.reduce((sum, entry) => sum + entry.lineTotalMinor, 0);
  return {
    lines: items.map(entry => ({
      ...entry,
      status: 'confirmed',
      expectedMinor: entry.lineTotalMinor,
      differenceMinor: 0,
    })),
    total: {
      expectedMinor,
      differenceMinor: declaredTotalMinor === undefined ? 0 : declaredTotalMinor - expectedMinor,
      valid: declaredTotalMinor === undefined || declaredTotalMinor === expectedMinor,
    },
  };
}
