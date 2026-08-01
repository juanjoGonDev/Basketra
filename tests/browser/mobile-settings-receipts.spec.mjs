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

test('settings remain readable and unobscured on narrow light and dark mobile layouts', async ({ page }, testInfo) => {
  for (const [colorScheme, viewport] of [
    ['light', { width: 320, height: 700 }],
    ['dark', { width: 430, height: 900 }],
  ]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme });
    await page.goto('/#home');
    await navigate(page, 'Ajustes');

    await expect(page.getByRole('heading', { name: 'Ajustes', exact: true })).toBeVisible();
    await expect(page.getByText('Sin inicio de sesión local')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Servidor y versión' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const metric = page.locator('.operations-metrics > div').first();
    const colors = await metric.evaluate(element => {
      const styles = getComputedStyle(element);
      return { foreground: styles.color, background: styles.backgroundColor };
    });
    expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);

    const lastCard = page.locator('.operations-card').last();
    await lastCard.scrollIntoViewIfNeeded();
    const clearance = await lastCard.evaluate(element => {
      const card = element.getBoundingClientRect();
      const navigation = document.querySelector('.bottom-nav')?.getBoundingClientRect();
      return navigation ? navigation.top - card.bottom : 1;
    });
    expect(clearance).toBeGreaterThanOrEqual(0);
    await page.screenshot({
      path: testInfo.outputPath(`settings-${colorScheme}-${viewport.width}.png`),
      fullPage: true,
    });
  }
});

test('OCR exposes cancellable running progress and receipt retailer suggestions', async ({ page, request }, testInfo) => {
  const retailerName = 'Mercado Progreso E2E';
  const seed = await request.post('/api/v1/receipts/confirm', {
    data: {
      importKey: 'retailer-browser-seed-0001',
      retailerName,
      originalText: 'Pan',
      declaredTotalMinor: 150,
      items: [{ description: 'Pan', quantity: 1, unitPriceMinor: 150, lineTotalMinor: 150 }],
    },
  });
  expect(seed.ok()).toBeTruthy();

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-camera').setInputFiles({
    name: 'progress.png',
    mimeType: 'image/png',
    buffer: validPng,
  });

  await page.route('**/api/v1/receipts/extract', async route => {
    await new Promise(resolve => setTimeout(resolve, 2500));
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ extraction: {} }),
      });
    } catch {
      // The expected cancellation closes the intercepted request before it can be fulfilled.
    }
  });

  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('#receipt-progress')).toBeVisible();
  await expect(page.locator('#receipt-progress-track')).toHaveAttribute('role', 'progressbar');
  await expect(page.locator('#receipt-progress-captures')).toHaveText('1 captura');
  await expect.poll(async () => page.locator('#receipt-progress-elapsed').textContent(), { timeout: 2200 }).not.toBe('0 s');
  await page.screenshot({ path: testInfo.outputPath('ocr-running.png'), fullPage: true });

  await page.getByRole('button', { name: 'Cancelar análisis', exact: true }).click();
  await expect(page.locator('#receipt-progress')).toBeHidden();
  await expect(page.locator('#receipt-state')).toContainText('Análisis cancelado');
  await expect(page.locator('#capture-list li')).toHaveCount(1);
  await page.unroute('**/api/v1/receipts/extract');

  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('#receipt-state')).toContainText('OCR local listo');
  await expect(page.locator('.receipt-item')).toHaveCount(1);

  await page.getByLabel('Comercio (opcional)', { exact: true }).fill('Mercado Pro');
  const suggestion = page.getByRole('option').filter({ hasText: retailerName });
  await expect(suggestion).toBeVisible();
  await expect(suggestion).toContainText('1 ticket guardado');
  await suggestion.click();
  await expect(page.getByLabel('Comercio (opcional)', { exact: true })).toHaveValue(retailerName);

  const confirmationRequest = page.waitForRequest(requestValue => new URL(requestValue.url()).pathname === '/api/v1/receipts/confirm');
  await page.getByRole('button', { name: 'Confirmar e importar', exact: true }).click();
  const payload = (await confirmationRequest).postDataJSON();
  expect(payload.retailerName).toBe(retailerName);
  await expect(page.locator('#receipt-state')).toContainText('Ticket importado');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('retailer-confirmed.png'), fullPage: true });
});
