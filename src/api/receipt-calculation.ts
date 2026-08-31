import { calculateReceiptLineTotal } from '../domain/receipt.ts';
import { asRecord, asSafeInteger } from '../domain/validation.ts';

type ReceiptCalculationApiContext = Readonly<{
  method?: string;
  pathname: string;
  readJson(): Promise<unknown>;
  send(status: number, body: unknown): void;
}>;

export async function handleReceiptCalculationRequest(context: ReceiptCalculationApiContext): Promise<boolean> {
  if (context.method !== 'POST' || context.pathname !== '/api/v1/receipts/calculate-line') return false;
  const body = asRecord(await context.readJson());
  const lineTotalMinor = calculateReceiptLineTotal({
    quantity: asSafeInteger(body['quantity'], '$.quantity', { min: 0, max: 100_000 }),
    unitPriceMinor: asSafeInteger(body['unitPriceMinor'], '$.unitPriceMinor', { min: 0 }),
    ...(body['discountMinor'] === undefined
      ? {}
      : { discountMinor: asSafeInteger(body['discountMinor'], '$.discountMinor', { min: 0 }) }),
  });
  context.send(200, { lineTotalMinor });
  return true;
}
