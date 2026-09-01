import {
  calculateReceiptLineDiscountMinor,
  calculateReceiptLineTotal,
  parseReceiptLineDiscount,
  type ReceiptLineCalculationInput,
} from '../domain/receipt.ts';
import { asRecord, asSafeInteger } from '../domain/validation.ts';

export const RECEIPT_LINE_CALCULATION_PATH = '/api/v1/receipts/calculate-line';

type ReceiptCalculationApiContext = Readonly<{
  method?: string | undefined;
  pathname: string;
  readJson(): Promise<unknown>;
  send(status: number, body: unknown): void;
}>;

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

function parseReceiptLineCalculation(value: unknown): ReceiptLineCalculationInput {
  const root = asRecord(value);
  return {
    quantity: asSafeInteger(root['quantity'], '$.quantity', { min: 0, max: 100_000 }),
    unitPriceMinor: asSafeInteger(root['unitPriceMinor'], '$.unitPriceMinor', { min: 0 }),
    ...parseDiscountFields(root),
  };
}

function calculateReceiptLineResponse(input: ReceiptLineCalculationInput): Readonly<{
  lineTotalMinor: number;
  discountMinor: number;
}> {
  return {
    lineTotalMinor: calculateReceiptLineTotal(input),
    discountMinor: calculateReceiptLineDiscountMinor(input),
  };
}

export async function handleReceiptCalculationRequest(context: ReceiptCalculationApiContext): Promise<boolean> {
  if (context.method !== 'POST' || context.pathname !== RECEIPT_LINE_CALCULATION_PATH) return false;
  const input = parseReceiptLineCalculation(await context.readJson());
  context.send(200, calculateReceiptLineResponse(input));
  return true;
}

export async function handleReceiptLineCalculationRequest(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== RECEIPT_LINE_CALCULATION_PATH || request.method !== 'POST') return undefined;
  const input = parseReceiptLineCalculation(await request.json());
  return new Response(JSON.stringify(calculateReceiptLineResponse(input)), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
