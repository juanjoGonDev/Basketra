import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

async function selectTicketTab(page, name) {
  await page.locator('[data-tab-group="tickets"]').getByRole('tab', { name, exact: true }).click();
}

test('background AI failure preserves the capture for retry without exposing upstream detail', async ({ page }) => {
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
  await page.locator('#receipt-files').setInputFiles({
    name: 'manual-recovery.png',
    mimeType: 'image/png',
    buffer: validPng,
  });

  await selectTicketTab(page, 'Progreso');
  const aiInput = page.getByLabel('Verificar y normalizar con IA');
  await page.locator('label.switch-row').filter({ has: aiInput }).click();
  await expect(aiInput).toBeChecked();
  await page.getByRole('button', { name: 'Leer con OCR local', exact: true }).click();

  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');
  await expect(page.locator('#receipt-state')).toContainText('El análisis no terminó');
  await expect(page.getByText('raw upstream detail must not be shown')).toHaveCount(0);
  await selectTicketTab(page, 'Capturas');
  await expect(page.getByRole('button', { name: 'Reintentar imagen', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revisar manualmente', exact: true })).toHaveCount(0);
});
