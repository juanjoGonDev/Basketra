/**
 * The ticket Store gate lives on the review model inputs, which the focused
 * validation workspace keeps mounted but out of the visible surface
 * (`.agents/specs/2026-09-12-pdf-direct-receipt-completion-ui.md`). Tests whose
 * subject is not the Store control therefore drive the same input events the
 * browser would emit instead of relying on the field being painted.
 */
export async function fillRequiredReceiptStore(
  page,
  { retailerName = 'ALCAMPO', storeName = 'ALCAMPO ALMERIA' } = {},
) {
  await page.evaluate(({ retailer, store }) => {
    for (const [selector, value] of [['#receipt-retailer', retailer], ['#receipt-store', store]]) {
      const field = document.querySelector(selector);
      if (!field) continue;
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, { retailer: retailerName, store: storeName });
}
