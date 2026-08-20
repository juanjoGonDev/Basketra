import { test, expect } from '@playwright/test';

test('mobile receipt review collapses evidence, amount and final action into one sticky row', async ({ page }) => {
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

  const toolbar = page.locator('#receipt-review-sticky-summary');
  const preview = page.getByRole('button', { name: 'Ampliar captura compact-toolbar.png', exact: true });
  const amount = toolbar.locator('.review-total strong');
  const finalize = toolbar.getByRole('button', { name: 'Validar', exact: true });

  await expect(toolbar).toBeVisible();
  await expect(page.locator('.receipt-review-evidence__compact')).toBeHidden();
  await expect(page.locator('#receipt-review-evidence-thumbnail')).toHaveCount(0);
  await expect(page.locator('#receipt-review-evidence-title')).toHaveCount(0);
  await expect(page.locator('#receipt-review-evidence-name')).toHaveCount(0);

  await expect(preview).toBeVisible();
  await expect(preview.locator('.icon')).toBeVisible();
  await expect(preview).toHaveText('');
  await expect(amount).toContainText(/1,50.*€/u);
  await expect(toolbar.getByText('Total calculado', { exact: true })).toBeHidden();
  await expect(toolbar.locator('.status-pill')).toBeHidden();
  await expect(finalize).toBeVisible();
  await expect(finalize.locator('.icon')).toBeVisible();

  const geometry = await page.evaluate(() => {
    const toolbarElement = document.querySelector('#receipt-review-sticky-summary');
    const previewElement = document.querySelector('#receipt-review-expand');
    const amountElement = toolbarElement.querySelector('.review-total strong');
    const finalizeElement = document.querySelector('#confirm-receipt');
    const toolbarRect = toolbarElement.getBoundingClientRect();
    const centers = [previewElement, amountElement, finalizeElement].map(element => {
      const rect = element.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    return {
      position: getComputedStyle(toolbarElement).position,
      height: toolbarRect.height,
      centerSpread: Math.max(...centers) - Math.min(...centers),
    };
  });

  expect(geometry.position).toBe('sticky');
  expect(geometry.height).toBeLessThanOrEqual(72);
  expect(geometry.centerSpread).toBeLessThanOrEqual(8);

  await preview.click();
  await expect(page.locator('#capture-preview-dialog')).toBeVisible();
  await expect(page.locator('#capture-preview-name')).toContainText('compact-toolbar.png');
});
