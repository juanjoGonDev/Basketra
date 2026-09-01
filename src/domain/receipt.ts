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

export function parseReceiptLineDiscount(value: unknown, path = 'discount'): ReceiptLineDiscount {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RangeError(`${path} must be a tagged discount object`);
  }
  const candidate = value as Record<string, unknown>;
  const type = candidate['type'];
  if (type === 'amount') {
    if ('basisPoints' in candidate) throw new RangeError(`${path} representation is mixed`);
    if (typeof candidate['amountMinor'] !== 'number') {
      throw new RangeError(`${path}.amountMinor must be a non-negative safe integer`);
    }
    assertNonNegativeSafeInteger(candidate['amountMinor'], `${path}.amountMinor`);
    return { type, amountMinor: candidate['amountMinor'] };
  }
  if (type === 'percentage') {
    if ('amountMinor' in candidate) throw new RangeError(`${path} representation is mixed`);
    if (typeof candidate['basisPoints'] !== 'number') {
      throw new RangeError(`${path}.basisPoints must be a non-negative safe integer`);
    }
    assertNonNegativeSafeInteger(candidate['basisPoints'], `${path}.basisPoints`);
    if (candidate['basisPoints'] > BASIS_POINTS_PER_WHOLE) {
      throw new RangeError(`${path}.basisPoints cannot exceed 100%`);
    }
    return { type, basisPoints: candidate['basisPoints'] };
  }
  throw new RangeError(`${path}.type must be amount or percentage`);
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

  const discount = parseReceiptLineDiscount(line.discount, 'Receipt line discount');
  if (discount.type === 'amount') {
    if (discount.amountMinor > subtotalMinor) throw new RangeError('Receipt line discount cannot exceed its subtotal');
    return discount.amountMinor;
  }

  const numerator = BigInt(subtotalMinor) * BigInt(discount.basisPoints);
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
