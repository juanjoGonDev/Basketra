import { test, expect } from '@playwright/test';

test('mobile receipt review groups evidence, amount and final action in the summary', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.bottom-nav').getByRole('button', { name: 'Tickets', exact: true }).click();

  await page.evaluate(async () => {
    const { state, captureKey } = await import('/receipt-state.js');
    const { renderReview } = await import('/receipt-review.js');
    const { syncCompactReviewEvidence, syncStickyReviewSummary } = await import('/receipts.js');

    const capture = {
      name: 'compact-toolbar.png',
      mimeType: 'image/png',
      bytes: 12,
      storageKey: `${'c'.repeat(64)}.png`,
      contentHash: 'c'.repeat(64),
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
    state.extraction = { final: { items: [item], declaredTotalMinor: 150 } };
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

  const summary = page.locator('#receipt-live-summary');
  const actions = page.locator('#receipt-live-summary-actions');
  const evidence = page.locator('#receipt-show-evidence');
  const validate = page.locator('#validate-receipt-ticket');
  const finalize = page.locator('#confirm-receipt');

  await expect(summary).toBeVisible();
  // The compact evidence chrome of the withdrawn panel must not come back.
  await expect(page.locator('.receipt-review-evidence__compact')).toBeHidden();
  await expect(page.locator('#receipt-review-evidence-thumbnail')).toHaveCount(0);
  await expect(page.locator('#receipt-review-evidence-title')).toHaveCount(0);
  await expect(page.locator('#receipt-review-evidence-name')).toHaveCount(0);

  await expect(summary.locator('#receipt-summary-total')).toContainText(/1,50.*\u20ac/u);
  for (const action of [evidence, validate, finalize]) await expect(action).toBeVisible();

  await actions.scrollIntoViewIfNeeded();
  const geometry = await page.evaluate(() => {
    const owner = document.querySelector('#receipt-live-summary-actions');
    const elements = ['#receipt-show-evidence', '#validate-receipt-ticket', '#confirm-receipt']
      .map(selector => document.querySelector(selector));
    return {
      grouped: elements.every(element => owner.contains(element)),
      minHeight: Math.min(...elements.map(element => element.getBoundingClientRect().height)),
      insideViewport: elements.every(element => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      }),
    };
  });

  expect(geometry.grouped, `the summary must own every review action: ${JSON.stringify(geometry)}`).toBe(true);
  expect(geometry.minHeight, `review actions must stay touch-safe: ${JSON.stringify(geometry)}`).toBeGreaterThanOrEqual(44);
  expect(geometry.insideViewport, `review actions must be reachable: ${JSON.stringify(geometry)}`).toBe(true);

  await evidence.click();
  await expect(page.locator('#receipt-evidence-dialog')).toBeVisible();
  await expect(page.locator('#receipt-evidence-dialog')).toContainText('compact-toolbar.png');
});
