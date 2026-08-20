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

test('mobile focus recovery falls back to the layout viewport when VisualViewport is unavailable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await navigate(page, 'Tickets');

  const result = await page.evaluate(async () => {
    const { keepMobileReviewFocusVisible } = await import('/receipts.js');
    const originalViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    const originalScrollBy = window.scrollBy;
    let scrollOptions = null;

    try {
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: null,
      });
      window.scrollBy = options => {
        scrollOptions = options;
      };

      keepMobileReviewFocusVisible(document.querySelector('#receipt-total'));
      await new Promise(resolve => requestAnimationFrame(resolve));

      return {
        finiteTop: Number.isFinite(scrollOptions?.top),
        left: scrollOptions?.left,
        behavior: scrollOptions?.behavior,
      };
    } finally {
      window.scrollBy = originalScrollBy;
      if (originalViewport) {
        Object.defineProperty(window, 'visualViewport', originalViewport);
      } else {
        delete window.visualViewport;
      }
    }
  });

  expect(result).toEqual({ finiteTop: true, left: 0, behavior: 'auto' });
});
