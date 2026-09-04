export async function fillRequiredReceiptStore(
  page,
  { retailerName = 'ALCAMPO', storeName = 'ALCAMPO ALMERIA' } = {},
) {
  await page.locator('#receipt-retailer').fill(retailerName);
  await page.locator('#receipt-store').fill(storeName);
}
