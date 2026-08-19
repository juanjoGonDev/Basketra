import { test, expect } from '@playwright/test';

test('sticky receipt review exposes visible canonical icons without replacing text labels', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();

  await page.evaluate(async () => {
    const { state, captureKey } = await import('/receipt-state.js');
    const { renderReview } = await import('/receipt-review.js');
    const { syncCompactReviewEvidence, syncStickyReviewSummary } = await import('/receipts.js');

    const capture = {
      name: 'icon-review.png',
      mimeType: 'image/png',
      bytes: 12,
      storageKey: `${'a'.repeat(64)}.png`,
      contentHash: 'a'.repeat(64),
    };
    const item = {
      description: 'PAN',
      quantity: 1,
      unitPriceMinor: 150,
      lineTotalMinor: 150,
      confidence: 1,
      userConfirmed: true,
    };

    state.captures = [capture];
    state.selectedReviewCaptureKey = captureKey(capture);
    state.items = [item];
    state.originalItems = [{ ...item }];

    renderReview([
      {
        status: 'confirmed',
        expectedMinor: 150,
        differenceMinor: 0,
      },
    ], {
      expectedMinor: 150,
      differenceMinor: 0,
      valid: true,
    });
    syncCompactReviewEvidence();
    syncStickyReviewSummary();
  });

  const expand = page.getByRole('button', { name: 'Ampliar captura', exact: true });
  const validation = page.locator('#receipt-review-sticky-summary .status-pill');
  const confirm = page.getByRole('button', { name: 'Confirmar e importar', exact: true });

  await expect(expand).toBeVisible();
  await expect(expand).toContainText('Ampliar');
  await expect(expand.locator('.icon')).toBeVisible();

  await expect(validation).toBeVisible();
  await expect(validation).toContainText('Total validado');
  await expect(validation.locator('.icon')).toBeVisible();

  await expect(confirm).toBeVisible();
  await expect(confirm.locator('.icon')).toBeVisible();
});
