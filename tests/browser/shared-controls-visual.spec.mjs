import { test, expect } from '@playwright/test';

const widths = [320, 390, 768, 1440, 1920];

test('shared controls align helper fields and retain rounded navigation at every width', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ['/inventory', '/inventory/products', '/inventory/categories', '/inventory/stores', '/inventory/statistics', '/tickets/history', '/settings']) {
      await page.goto(route);
      await expect(page.locator('html')).not.toHaveAttribute('data-route-pending', 'true');
      const geometry = await page.evaluate(() => {
        const visible = element => element.getBoundingClientRect().width > 0;
        return {
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          tabs: [...document.querySelectorAll('.task-tab')].filter(visible).map(element => parseFloat(getComputedStyle(element).borderRadius)),
          selects: [...document.querySelectorAll('select')].filter(visible).map(element => ({ radius: parseFloat(getComputedStyle(element).borderRadius), height: element.getBoundingClientRect().height, appearance: getComputedStyle(element).appearance, background: getComputedStyle(element).backgroundImage })),
        };
      });
      expect(geometry.overflow, route).toBe(false);
      for (const radius of geometry.tabs) expect(radius, route).toBeGreaterThanOrEqual(12);
      for (const control of geometry.selects) {
        expect(control.radius, route).toBe(24);
        expect(control.appearance, route).toBe('none');
        expect(control.background, route).not.toBe('none');
        expect(control.height, route).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: testInfo.outputPath(`${route.replaceAll('/', '-')}-${width}.png`), fullPage: true });
    }
    await page.goto('/inventory');
    await expect(page.locator('.inventory-overview-tabs')).toBeVisible();
    await page.evaluate(() => {
      const panel = document.createElement('div');
      panel.id = 'alignment-proof';
      panel.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px';
      panel.innerHTML = '<label class="field"><span>First field</span><input value="First"></label><label class="field"><span>Second field</span><select><option>Second</option></select><small>Long helper text that wraps across multiple lines without moving either control out of its aligned row.</small><span class="field-error">A longer validation message must also wrap safely.</span></label>';
      document.querySelector('.view.active').prepend(panel);
    });
    const [first, second] = await Promise.all([page.locator('#alignment-proof input').boundingBox(), page.locator('#alignment-proof select').boundingBox()]);
    expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(first.height - second.height)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`field-feedback-${width}.png`), fullPage: true });
  }
});


test('ticket metadata controls align with a wrapped store explanation', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.route('**/api/v1/inventory/stores?*', route => route.fulfill({ json: { stores: [{ id: 'store_visual', name: 'Market Central', retailerName: 'Market' }], total: 1, hasMore: false } }));
  await page.route('**/api/v1/inventory/tickets/ticket_visual', route => route.fulfill({ json: { ticket: {
    id: 'ticket_visual', retailerName: 'Market', storeId: 'store_visual', storeName: 'Market Central',
    purchasedAt: '2026-09-02T18:30:00.000Z', paymentStatus: 'paid', paymentMethod: 'Card',
    taxMinor: 0, receiptDiscountMinor: 0, declaredTotalMinor: 150, items: [],
  } } }));
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/tickets/history/ticket_visual');
    await expect(page.locator('#ticket-editor-store')).toHaveValue('store_visual');
    await expect(page.locator('#ticket-editor-store')).toBeVisible();
    const boxes = await page.locator('.ticket-editor-metadata-grid :is(input, select)').evaluateAll(controls => controls.map(control => {
      const box = control.getBoundingClientRect();
      return { x: box.x, y: box.y, height: box.height };
    }));
    for (const box of boxes) expect(box.height).toBe(boxes[0].height);
    if (width >= 1440) for (const box of boxes) expect(box.y).toBe(boxes[0].y);
    await page.screenshot({ path: testInfo.outputPath(`ticket-metadata-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'AÃ±adir artÃ­culo', exact: true }).click();
    await expect(page.locator('.receipt-invoice-dialog[open]')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`ticket-add-line-${width}.png`), fullPage: true });
  }
});
