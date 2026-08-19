import { test, expect } from '@playwright/test';

test('desktop sticky receipt review keeps canonical validation icons and full action labels', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
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

  const expand = page.getByRole('button', { name: 'Ampliar captura icon-review.png', exact: true });
  const validation = page.locator('#receipt-review-sticky-summary .status-pill');
  const confirm = page.getByRole('button', { name: 'Confirmar e importar', exact: true });

  await expect(expand).toBeHidden();
  await expect(validation).toBeVisible();
  await expect(validation).toContainText('Total validado');
  await expect(validation).toHaveClass(/success/u);
  await expect(validation.locator('.icon')).toBeVisible();

  await expect(confirm).toBeVisible();
  await expect(confirm.locator('.icon')).toBeVisible();

  await page.evaluate(async () => {
    const { renderReview } = await import('/receipt-review.js');
    const { syncStickyReviewSummary } = await import('/receipts.js');
    renderReview([
      {
        status: 'confirmed',
        expectedMinor: 150,
        differenceMinor: 0,
      },
    ], {
      expectedMinor: 175,
      differenceMinor: 25,
      valid: false,
    });
    syncStickyReviewSummary();
  });

  await expect(validation).toContainText('Revisar total');
  await expect(validation).toHaveClass(/warning/u);
  await expect(validation.locator('.icon')).toBeVisible();
});
