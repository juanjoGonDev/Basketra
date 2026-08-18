import { test, expect } from '@playwright/test';

const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==', 'base64');

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

function configuredAiSettings() {
  return {
    configured: true,
    status: 'configured',
    missing: [],
    baseUrl: 'http://host.docker.internal:3001/v1/',
    model: 'gpt-5',
    apiKeyMask: '***test',
    image: true,
    pdf: false,
    loopbackWarning: false,
    requiresContainerRecreate: true,
    recommendedHostUrl: 'http://host.docker.internal:3001/v1/',
  };
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
}

async function prepareReceiptReview(page) {
  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-camera').setInputFiles({
    name: 'review.png',
    mimeType: 'image/png',
    buffer: validPng,
  });
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();
  await expect(page.locator('.receipt-item')).toHaveCount(1);
}

test('settings coalesce AI configuration reads and keep the expensive probe manual', async ({ page }) => {
  let settingsReads = 0;
  let probePosts = 0;

  await page.route('**/api/v1/settings/ai-provider', route => {
    if (route.request().method() === 'GET') settingsReads += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(configuredAiSettings()),
    });
  });
  await page.route('**/api/v1/settings/ai-provider/test', route => {
    probePosts += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        connection: {
          ok: true,
          model: 'gpt-5',
          imageStructuredOutput: true,
        },
      }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Ajustes');
  await expect(page.locator('#ai-configuration-status')).toHaveText('Configuración cargada');

  await page.waitForTimeout(2200);
  const startupReads = settingsReads;
  expect(startupReads).toBeLessThanOrEqual(2);
  expect(probePosts).toBe(0);

  await page.getByRole('button', { name: 'Verificar imagen y JSON estricto', exact: true }).click();
  await expect.poll(() => probePosts).toBe(1);
  await expect(page.locator('#ai-test-state')).toContainText('Capacidad verificada');
  await page.waitForTimeout(500);
  expect(probePosts).toBe(1);
  expect(settingsReads).toBeLessThanOrEqual(startupReads + 1);
});

test('receipt review hides destructive rails and exposes confirmation errors next to the action', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let confirmPosts = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/receipts/confirm') {
      confirmPosts += 1;
    }
  });

  await prepareReceiptReview(page);

  const firstShell = page.locator('[data-swipe-kind="receipt-line"]').first();
  const actionRail = firstShell.locator('[data-swipe-actions]');
  await expect(firstShell).toHaveAttribute('data-swipe-open', 'false');
  await expect(actionRail).toHaveCSS('visibility', 'hidden');
  await expect(firstShell.locator('[data-receipt-validation]')).toHaveText(/^(Revisar|Validada)$/);
  await expect(firstShell.getByText('needs-review', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Mostrar acciones de la línea 1' }).click();
  await expect(firstShell).toHaveAttribute('data-swipe-open', 'true');
  await expect(actionRail).toHaveCSS('visibility', 'visible');
  await page.keyboard.press('Escape');
  await expect(firstShell).toHaveAttribute('data-swipe-open', 'false');
  await expect(actionRail).toHaveCSS('visibility', 'hidden');

  await page.getByRole('button', { name: 'Añadir línea', exact: true }).click();
  await expect(page.locator('.receipt-item')).toHaveCount(2);
  await page.getByRole('button', { name: 'Confirmar e importar', exact: true }).click();

  const feedback = page.locator('#receipt-confirm-state');
  await expect(feedback).toBeVisible();
  await expect(feedback).toContainText(/Revisa|Producto|línea|ticket/i);
  expect(confirmPosts).toBe(0);
  await expect(page.locator('#capture-list li')).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('receipt-confirmation-error.png'), fullPage: true });
});

test('receipt review keeps product and numeric fields readable on expanded layouts', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await prepareReceiptReview(page);

  const geometry = await page.locator('.receipt-item').first().evaluate(item => {
    const description = item.querySelector('[data-field="description"]').getBoundingClientRect();
    const quantity = item.querySelector('[data-field="quantity"]').getBoundingClientRect();
    const unitPrice = item.querySelector('[data-field="unitPriceEuro"]').getBoundingClientRect();
    const lineTotal = item.querySelector('[data-field="lineTotalEuro"]').getBoundingClientRect();
    const card = item.getBoundingClientRect();
    return {
      cardWidth: card.width,
      descriptionWidth: description.width,
      quantityTop: quantity.top,
      unitPriceTop: unitPrice.top,
      lineTotalTop: lineTotal.top,
      inputHeights: [description.height, quantity.height, unitPrice.height, lineTotal.height],
    };
  });

  expect(geometry.cardWidth).toBeGreaterThan(700);
  expect(geometry.descriptionWidth).toBeGreaterThan(geometry.cardWidth * .8);
  expect(Math.abs(geometry.quantityTop - geometry.unitPriceTop)).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.unitPriceTop - geometry.lineTotalTop)).toBeLessThanOrEqual(2);
  expect(geometry.inputHeights.every(height => height >= 44)).toBeTruthy();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('receipt-review-desktop.png'), fullPage: true });
});
