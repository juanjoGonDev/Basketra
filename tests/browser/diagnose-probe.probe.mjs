import { test } from '@playwright/test';

// TEMPORARY CI diagnostic probe. It is excluded from playwright.config.mjs by its file name and runs
// only through playwright.diagnose.config.mjs. Every test fails on purpose so the collected facts are
// published as check-run annotations. Delete this file once the diagnosis is complete.

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const EXTRACTION = {
  originalText: 'PAN 1,50',
  final: {
    items: [{
      description: 'PAN',
      quantity: 1,
      unitPriceMinor: 150,
      lineTotalMinor: 150,
      confidence: 1,
      sourceLines: [1],
    }],
    declaredTotalMinor: 150,
    review: {
      lines: [{ status: 'confirmed', expectedMinor: 150, differenceMinor: 0 }],
      total: { expectedMinor: 150, differenceMinor: 0, valid: true },
    },
  },
};

const BOOT_IDS = [
  'capture-list',
  'receipt-review',
  'receipt-review-capture',
  'receipt-review-panel',
  'close-capture-preview',
  'cancel-receipt-extraction',
  'review-receipt',
  'confirm-receipt',
  'add-manual-line',
  'receipt-retailer',
  'retailer-suggestions',
  'receipt-store',
  'receipt-store-options',
  'receipt-detected-list',
  'receipt-live-summary',
  'validate-receipt-ticket',
  'receipt-line-dialog',
];

test('probe boot integrity and receipt retailer wiring', async ({ page }) => {
  const runtime = [];
  page.on('pageerror', error => runtime.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') runtime.push(`console: ${message.text()}`);
  });
  await page.route('**/api/v1/retailers/suggestions?*', route => json(route, {
    suggestions: [{ name: 'ALCAMPO', receiptCount: 2 }],
  }));
  await page.route('**/api/v1/inventory/stores?*', route => json(route, {
    stores: [{ id: 'store_ok', name: 'ALCAMPO ALMERIA', retailerName: 'ALCAMPO' }],
    total: 1,
    offset: 0,
    limit: 100,
    hasMore: false,
  }));

  await page.goto('/tickets');

  const facts = {};
  // initReceipts() failures are swallowed into these nodes by app.js initialize().
  facts.boot = await page.evaluate(ids => ({
    listState: document.querySelector('#list-state')?.textContent?.trim() ?? null,
    uploadState: document.querySelector('#upload-state')?.textContent?.trim() ?? null,
    receiptState: document.querySelector('#receipt-state')?.textContent?.trim() ?? null,
    toast: document.querySelector('#toast-message')?.textContent?.trim() ?? null,
    missingIds: ids.filter(id => !document.getElementById(id)),
    retailerCount: document.querySelectorAll('#receipt-retailer').length,
    reviewEditorCount: document.querySelectorAll('.receipt-review-editor').length,
    detectedItems: document.querySelectorAll('#receipt-detected-list .receipt-detected-item').length,
    reviewItems: document.querySelectorAll('#receipt-review .receipt-item').length,
  }), BOOT_IDS);

  await page.evaluate(() => {
    window.__probeRequests = [];
    const native = window.fetch;
    window.fetch = (...args) => {
      window.__probeRequests.push(String(args[0]?.url ?? args[0]));
      return native(...args);
    };
  });

  facts.setup = await page.evaluate(async extraction => {
    const report = {};
    try {
      const { installReceiptEnhancements } = await import('/receipts.js');
      installReceiptEnhancements();
      report.installed = true;
    } catch (error) {
      report.installError = String(error);
    }
    try {
      const { applyExtraction } = await import('/receipt-review.js');
      applyExtraction(extraction);
      report.applied = true;
    } catch (error) {
      report.applyError = String(error);
    }
    const panel = document.querySelector('#receipt-review-panel');
    if (panel) panel.open = true;
    report.panelOpen = Boolean(panel?.open);
    report.requestsAfterSetup = window.__probeRequests.length;
    return report;
  }, EXTRACTION);

  facts.dom = await page.evaluate(ids => ({
    missingIds: ids.filter(id => !document.getElementById(id)),
    retailerCount: document.querySelectorAll('#receipt-retailer').length,
    retailerParent: document.querySelector('#receipt-retailer')?.parentElement?.className ?? null,
    retailerInEditor: Boolean(document.querySelector('#receipt-retailer')?.closest('.receipt-review-editor')),
    detectedItems: [...document.querySelectorAll('#receipt-detected-list .receipt-detected-item')]
      .map(item => ({ action: item.dataset.receiptAction ?? null, provisional: item.dataset.provisional ?? null })),
    reviewItems: document.querySelectorAll('#receipt-review .receipt-item').length,
    dialogPresent: Boolean(document.querySelector('#receipt-line-dialog')),
  }), BOOT_IDS);

  // Synthetic input, exactly like changed-code-boundaries.spec.mjs.
  await page.locator('#receipt-retailer').evaluate(element => {
    element.value = 'AL';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1500);
  facts.afterSyntheticInput = await page.evaluate(() => ({
    requests: window.__probeRequests.slice(),
    suggestionOptions: document.querySelectorAll('#retailer-suggestions [role="option"]').length,
    suggestionsHidden: document.querySelector('#retailer-suggestions')?.hidden ?? null,
    ariaExpanded: document.querySelector('#receipt-retailer')?.getAttribute('aria-expanded') ?? null,
    storeOptions: document.querySelectorAll('#receipt-store-options option').length,
  }));

  // Synthetic change, exactly like changed-code-residuals.spec.mjs.
  await page.locator('#receipt-retailer').evaluate(element => {
    element.value = 'ALCAMPO';
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(1500);
  facts.afterSyntheticChange = await page.evaluate(() => ({
    requests: window.__probeRequests.slice(),
    storeOptions: document.querySelectorAll('#receipt-store-options option').length,
    storeOptionValues: [...document.querySelectorAll('#receipt-store-options option')].map(option => option.value),
  }));

  // Calling the module function directly separates "listener not bound" from "fetch path broken".
  facts.directModuleCall = await page.evaluate(async () => {
    const before = window.__probeRequests.length;
    try {
      const review = await import('/receipt-review.js');
      review.scheduleRetailerSuggestions();
      await new Promise(resolve => setTimeout(resolve, 1200));
      return {
        ok: true,
        addedRequests: window.__probeRequests.slice(before),
        suggestionOptions: document.querySelectorAll('#retailer-suggestions [role="option"]').length,
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  // Trusted Playwright input after lifting the retired panel's CSS block.
  facts.trustedTyping = await (async () => {
    try {
      await page.addStyleTag({ content: '#receipt-review-panel { display: block !important; }' });
      await page.locator('#receipt-retailer').scrollIntoViewIfNeeded({ timeout: 3000 });
      const before = await page.evaluate(() => window.__probeRequests.length);
      await page.locator('#receipt-retailer').fill('ALCAM', { timeout: 5000 });
      await page.waitForTimeout(1500);
      const after = await page.evaluate(() => ({
        requests: window.__probeRequests.slice(),
        suggestionOptions: document.querySelectorAll('#retailer-suggestions [role="option"]').length,
      }));
      return { ok: true, addedRequests: after.requests.slice(before), suggestionOptions: after.suggestionOptions };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  })();

  // Detected line -> modal, the contract asserted by receipt-auto-review-flow.spec.mjs.
  facts.detectedLineModal = await (async () => {
    const report = {};
    try {
      await page.locator('#receipt-detected-list .receipt-detected-item').first().click({ timeout: 5000 });
      report.clicked = true;
    } catch (error) {
      report.clickError = String(error).split('\n')[0];
      report.clicked = await page.evaluate(() => {
        const item = document.querySelector('#receipt-detected-list .receipt-detected-item');
        if (!item) return false;
        item.click();
        return true;
      });
    }
    await page.waitForTimeout(800);
    report.dialog = await page.evaluate(() => {
      const dialog = document.querySelector('#receipt-line-dialog');
      if (!dialog) return { present: false };
      return {
        present: true,
        hidden: dialog.hidden,
        open: dialog.open ?? null,
        display: getComputedStyle(dialog).display,
        reviewItems: document.querySelectorAll('#receipt-review .receipt-item').length,
      };
    });
    return report;
  })();

  facts.runtime = runtime;
  throw new Error(`PROBE-RETAILER-WIRING ${JSON.stringify(facts, null, 1)}`);
});
