// TEMPORARY diagnostic probe (removed before delivery).
// Verifies the boot race behind changed-code-boundaries / changed-code-residuals:
// variant A drives synthetic events right after goto (pre-fix), variant B waits for the
// application-created field (post-fix). Request logging uses Playwright events because the
// application binds fetch at module load, so a window.fetch spy observes nothing.
import { expect, test } from '@playwright/test';

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function dispatchRetailer(page, type, value) {
  await page.locator('#receipt-retailer').evaluate((element, payload) => {
    element.value = payload.value;
    element.dispatchEvent(new Event(payload.type, { bubbles: true }));
  }, { type, value });
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const { state } = await import('/receipt-state.js');
    return {
      booted: Boolean(state.metadata),
      aiConfigured: Boolean(state.aiConfigured),
      retailer: document.querySelector('#receipt-retailer')?.value ?? null,
      manuallyEdited: Boolean(state.retailerManuallyEdited),
      suggestionOptions: document.querySelectorAll('#retailer-suggestions [role="option"]').length,
      suggestionsHidden: document.querySelector('#retailer-suggestions')?.hidden ?? null,
      ariaExpanded: document.querySelector('#receipt-retailer')?.getAttribute('aria-expanded') ?? null,
      storeOptions: [...document.querySelectorAll('#receipt-store-options option')].map(option => option.value),
      pendingSuggestionTimer: Boolean(state.retailerSuggestionTimer),
    };
  });
}

test('probe: retailer wiring before and after waiting for boot', async ({ page }) => {
  const requests = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.includes('/api/v1/retailers/suggestions') || url.pathname.includes('/api/v1/inventory/stores')) {
      requests.push(`${request.method()} ${url.pathname}${url.search}`);
    }
  });
  await page.route('**/api/v1/retailers/suggestions?*', route => json(route, {
    suggestions: [{ name: 'ALCAMPO', receiptCount: 2 }],
  }));
  await page.route('**/api/v1/inventory/stores?*', route => {
    const retailer = new URL(route.request().url()).searchParams.get('retailer');
    return json(route, {
      stores: [{ id: 'store_ok', name: 'ALCAMPO ALMERIA', retailerName: retailer || 'ALCAMPO' }],
      total: 1, offset: 0, limit: 100, hasMore: false,
    });
  });

  const applyExtraction = async () => page.evaluate(async () => {
    const module = await import('/receipt-review.js');
    module.applyExtraction({
      originalText: 'PAN 1,50',
      final: {
        items: [{ description: 'PAN', quantity: 1, unitPriceMinor: 150, lineTotalMinor: 150, confidence: 1, sourceLines: [1] }],
        declaredTotalMinor: 150,
        review: {
          lines: [{ status: 'confirmed', expectedMinor: 150, differenceMinor: 0 }],
          total: { expectedMinor: 150, differenceMinor: 0, valid: true },
        },
      },
    });
    document.querySelector('#receipt-review-panel').open = true;
  });

  // --- Variant A: pre-fix sequence (manual install, events dispatched immediately) ---
  await page.goto('/tickets');
  await page.evaluate(async () => {
    const { installReceiptEnhancements } = await import('/receipts.js');
    installReceiptEnhancements();
  });
  await applyExtraction();
  const aBefore = await snapshot(page);
  await dispatchRetailer(page, 'input', 'AL');
  await page.waitForTimeout(1500);
  const aAfterInput = await snapshot(page);
  const aRequests = requests.slice();
  requests.length = 0;
  await dispatchRetailer(page, 'change', 'ALCAMPO');
  await page.waitForTimeout(1500);
  const aAfterChange = await snapshot(page);

  // --- Variant B: post-fix sequence (wait for the application-created field) ---
  await page.goto('/tickets');
  await expect(page.locator('#receipt-retailer')).toBeAttached();
  const bBefore = await snapshot(page);
  await applyExtraction();
  await dispatchRetailer(page, 'input', 'AL');
  await page.waitForTimeout(1500);
  const bAfterInput = await snapshot(page);
  const bRequests = requests.slice();
  requests.length = 0;
  await dispatchRetailer(page, 'change', 'ALCAMPO');
  await page.waitForTimeout(1500);
  const bAfterChange = await snapshot(page);

  const report = {
    variantA: { before: aBefore, afterInput: aAfterInput, afterChange: aAfterChange, requests: aRequests },
    variantB: { before: bBefore, afterInput: bAfterInput, afterChange: bAfterChange, requests: bRequests },
  };
  throw new Error(`PROBE-REPORT ${JSON.stringify(report)}`);
});
