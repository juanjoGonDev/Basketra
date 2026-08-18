import { test, expect } from '@playwright/test';

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==',
  'base64',
);

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

test('background AI failure preserves the automatically queued capture for retry without upstream detail', async ({ page }) => {
  await page.route('**/api/v1/settings/ai-provider', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: true }),
  }));

  let submitted;
  await page.route('**/api/v1/receipts/extraction-jobs**', route => {
    if (route.request().method() === 'POST') submitted = route.request().postDataJSON();
    return route.fulfill({
      status: route.request().method() === 'POST' ? 202 : 200,
      contentType: 'application/json',
      body: JSON.stringify({
        job: route.request().method() === 'POST'
          ? { id: 'receiptextractionjob_aifailure' }
          : { id: 'receiptextractionjob_aifailure', status: 'failed', errorCode: 'AI_UNREACHABLE' },
      }),
    });
  });

  await page.goto('/');
  await navigate(page, 'Tickets');
  await page.locator('#receipt-files').setInputFiles({
    name: 'manual-recovery.png',
    mimeType: 'image/png',
    buffer: validPng,
  });

  await expect.poll(() => submitted?.verifyWithAi).toBe(true);
  await expect(page.locator('.capture-card .status-pill')).toHaveText('Error');
  await expect(page.locator('#receipt-state')).toContainText('procesamiento automático no terminó');
  await expect(page.getByText('raw upstream detail must not be shown')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reintentar imagen', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revisar manualmente', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Leer con OCR local', exact: true })).toHaveCount(0);
});
