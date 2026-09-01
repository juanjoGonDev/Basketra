import {
  calculateReceiptLineDiscountMinor,
  calculateReceiptLineTotal,
  parseReceiptLineDiscount,
  type ReceiptLineCalculationInput,
} from '../domain/receipt.ts';
import { asRecord, asSafeInteger } from '../domain/validation.ts';
import { jsonResponse } from './http.ts';

export const RECEIPT_LINE_CALCULATION_PATH = '/api/v1/receipts/calculate-line';

function parseDiscountFields(root: Record<string, unknown>): Pick<ReceiptLineCalculationInput, 'discount' | 'discountMinor'> {
  const discount = root['discount'];
  const discountMinor = root['discountMinor'];
  if (discount !== undefined && discountMinor !== undefined) {
    throw new RangeError('Receipt line discount representation is mixed');
  }
  if (discount !== undefined) return { discount: parseReceiptLineDiscount(discount, '$.discount') };
  if (discountMinor !== undefined) {
    return { discountMinor: asSafeInteger(discountMinor, '$.discountMinor', { min: 0 }) };
  }
  return {};
}

export async function handleReceiptLineCalculationRequest(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== RECEIPT_LINE_CALCULATION_PATH || request.method !== 'POST') return undefined;
  const root = asRecord(await request.json());
  const input: ReceiptLineCalculationInput = {
    quantity: asSafeInteger(root['quantity'], '$.quantity', { min: 0, max: 100_000 }),
    unitPriceMinor: asSafeInteger(root['unitPriceMinor'], '$.unitPriceMinor', { min: 0 }),
    ...parseDiscountFields(root),
  };
  return jsonResponse({
    lineTotalMinor: calculateReceiptLineTotal(input),
    discountMinor: calculateReceiptLineDiscountMinor(input),
  });
}
