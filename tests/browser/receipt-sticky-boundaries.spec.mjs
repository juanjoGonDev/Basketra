import { test, expect } from '@playwright/test';

function navigate(page, name) {
  return page.locator('.bottom-nav').getByRole('button', { name, exact: true }).click();
}

test('sticky review summary tolerates partial DOM teardown', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Tickets');

  const result = await page.evaluate(async () => {
    const { syncStickyReviewSummary } = await import('/receipts.js');
    const detachAndRestore = selector => {
      const element = document.querySelector(selector);
      const parent = element.parentNode;
      const nextSibling = element.nextSibling;
      element.remove();
      syncStickyReviewSummary();
      parent.insertBefore(element, nextSibling);
    };

    detachAndRestore('#receipt-review-sticky-summary');
    detachAndRestore('#receipt-review');
    detachAndRestore('#confirm-receipt');
    syncStickyReviewSummary();

    return {
      sticky: Boolean(document.querySelector('#receipt-review-sticky-summary')),
      review: Boolean(document.querySelector('#receipt-review')),
      confirm: Boolean(document.querySelector('#confirm-receipt')),
    };
  });

  expect(result).toEqual({ sticky: true, review: true, confirm: true });
});
