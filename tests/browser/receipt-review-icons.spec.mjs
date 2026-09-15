import { test, expect } from '@playwright/test';

test('desktop receipt summary keeps canonical action icons and full labels', async ({ page }) => {
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
    state.extraction = { final: { items: [item], declaredTotalMinor: 150 } };

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

  const summary = page.locator('#receipt-live-summary');
  const actions = page.locator('#receipt-live-summary-actions');
  const expand = page.getByRole('button', { name: 'Ampliar captura icon-review.png', exact: true });
  const confirm = page.locator('#confirm-receipt');

  // The withdrawn panel's compact evidence toggle must not resurface.
  await expect(expand).toBeHidden();
  await expect(page.locator('#receipt-review-panel')).toBeHidden();

  await expect(summary).toBeVisible();
  await expect(summary.locator('#receipt-summary-total')).toContainText(/1,50.*\u20ac/u);
  await expect(actions).toBeVisible();
  await expect(actions.locator('#receipt-show-evidence')).toBeVisible();
  await expect(actions.locator('#validate-receipt-ticket')).toBeVisible();
  await expect(confirm).toBeVisible();
  await expect(confirm.locator('.icon')).toBeVisible();
  await expect(confirm).toContainText('Confirmar e importar');

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

  // A mismatching total keeps the same actions available; the import asks for approval.
  await expect(summary).toBeVisible();
  await expect(confirm).toBeVisible();
  await expect(page.locator('#receipt-review-sticky-summary')).toBeHidden();
});
