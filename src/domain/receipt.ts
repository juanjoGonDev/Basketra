export type ReceiptLineDiscount =
  | Readonly<{ type: 'amount'; amountMinor: number }>
  | Readonly<{ type: 'percentage'; basisPoints: number }>;

export type ReceiptLineDiscountFields = Readonly<{
  discount?: ReceiptLineDiscount;
  /** @deprecated Compatibility input for historical amount-only clients. */
  discountMinor?: number;
}>;

export type ReceiptLineInput = Readonly<{
  description: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}> & ReceiptLineDiscountFields;

export type ReceiptLineCalculationInput = Readonly<{
  quantity: number;
  unitPriceMinor: number;
}> & ReceiptLineDiscountFields;

export type ReceiptLineValidation = Readonly<{
  status: 'confirmed' | 'needs-review' | 'unreadable' | 'arithmetic-mismatch';
  expectedMinor: number;
  differenceMinor: number;
}>;

const BASIS_POINTS_PER_PERCENT = 100;
const BASIS_POINTS_PER_WHOLE = 100 * BASIS_POINTS_PER_PERCENT;
const HALF_BASIS_POINT_DENOMINATOR = BASIS_POINTS_PER_WHOLE / 2;

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function receiptLineSubtotalMinor(line: Pick<ReceiptLineCalculationInput, 'quantity' | 'unitPriceMinor'>): number {
  assertNonNegativeSafeInteger(line.quantity, 'Receipt line quantity');
  assertNonNegativeSafeInteger(line.unitPriceMinor, 'Receipt line unit price');
  const subtotalMinor = line.quantity * line.unitPriceMinor;
  if (!Number.isSafeInteger(subtotalMinor)) {
    throw new RangeError('Receipt line subtotal exceeds the safe integer range');
  }
  return subtotalMinor;
}

function assertDiscountShape(discount: ReceiptLineDiscount): void {
  if (typeof discount !== 'object' || discount === null) {
    throw new RangeError('Receipt line discount must be a tagged object');
  }
  const candidate = discount as ReceiptLineDiscount & Record<string, unknown>;
  if (candidate.type === 'amount') {
    if ('basisPoints' in candidate) throw new RangeError('Receipt line discount representation is mixed');
    assertNonNegativeSafeInteger(candidate.amountMinor, 'Receipt line amount discount');
    return;
  }
  if (candidate.type === 'percentage') {
    if ('amountMinor' in candidate) throw new RangeError('Receipt line discount representation is mixed');
    assertNonNegativeSafeInteger(candidate.basisPoints, 'Receipt line percentage discount');
    if (candidate.basisPoints > BASIS_POINTS_PER_WHOLE) {
      throw new RangeError('Receipt line percentage discount cannot exceed 100%');
    }
    return;
  }
  throw new RangeError('Receipt line discount type must be amount or percentage');
}

/**
 * Resolves the effective monetary discount in euro cents.
 * Percentage discounts use basis points and integer half-up rounding to the nearest cent.
 */
export function calculateReceiptLineDiscountMinor(line: ReceiptLineCalculationInput): number {
  const subtotalMinor = receiptLineSubtotalMinor(line);
  if (line.discount !== undefined && line.discountMinor !== undefined) {
    throw new RangeError('Receipt line discount representation is mixed');
  }
  if (line.discountMinor !== undefined) {
    assertNonNegativeSafeInteger(line.discountMinor, 'Receipt line amount discount');
    if (line.discountMinor > subtotalMinor) throw new RangeError('Receipt line discount cannot exceed its subtotal');
    return line.discountMinor;
  }
  if (line.discount === undefined) return 0;

  assertDiscountShape(line.discount);
  if (line.discount.type === 'amount') {
    if (line.discount.amountMinor > subtotalMinor) throw new RangeError('Receipt line discount cannot exceed its subtotal');
    return line.discount.amountMinor;
  }

  const numerator = BigInt(subtotalMinor) * BigInt(line.discount.basisPoints);
  return Number((numerator + BigInt(HALF_BASIS_POINT_DENOMINATOR)) / BigInt(BASIS_POINTS_PER_WHOLE));
}

export function calculateReceiptLineTotal(line: ReceiptLineCalculationInput): number {
  const subtotalMinor = receiptLineSubtotalMinor(line);
  const discountMinor = calculateReceiptLineDiscountMinor(line);
  return subtotalMinor - discountMinor;
}

export function validateReceiptLine(line: ReceiptLineInput): ReceiptLineValidation {
  assertNonNegativeSafeInteger(line.lineTotalMinor, 'Receipt line total');
  const expectedMinor = calculateReceiptLineTotal(line);
  if (!line.description.trim()) {
    return { status: 'unreadable', expectedMinor, differenceMinor: line.lineTotalMinor - expectedMinor };
  }
  const differenceMinor = line.lineTotalMinor - expectedMinor;
  return {
    status: differenceMinor === 0 ? 'confirmed' : 'arithmetic-mismatch',
    expectedMinor,
    differenceMinor,
  };
}

export function validateReceiptTotal(lines: readonly ReceiptLineInput[], declaredTotalMinor: number): Readonly<{ expectedMinor: number; differenceMinor: number; valid: boolean }> {
  assertNonNegativeSafeInteger(declaredTotalMinor, 'Declared total');
  let expectedMinor = 0;
  for (const line of lines) {
    assertNonNegativeSafeInteger(line.lineTotalMinor, 'Receipt line total');
    expectedMinor += line.lineTotalMinor;
    if (!Number.isSafeInteger(expectedMinor)) throw new RangeError('Receipt total exceeds the safe integer range');
  }
  const differenceMinor = declaredTotalMinor - expectedMinor;
  return { expectedMinor, differenceMinor, valid: differenceMinor === 0 };
}

export function deduplicateOverlappingLines(lines: readonly ReceiptLineInput[]): ReceiptLineInput[] {
  const seen = new Set<string>();
  const result: ReceiptLineInput[] = [];
  for (const line of lines) {
    const key = `${line.description.trim().toLowerCase()}|${line.quantity}|${line.unitPriceMinor}|${line.lineTotalMinor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }
  return result;
}
