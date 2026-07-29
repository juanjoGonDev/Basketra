export type ReceiptLineInput = Readonly<{
  description: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  discountMinor?: number;
}>;

export type ReceiptLineValidation = Readonly<{
  status: 'confirmed' | 'needs-review' | 'unreadable' | 'arithmetic-mismatch';
  expectedMinor: number;
  differenceMinor: number;
}>;

export function validateReceiptLine(line: ReceiptLineInput): ReceiptLineValidation {
  if (!line.description.trim()) {
    return { status: 'unreadable', expectedMinor: 0, differenceMinor: line.lineTotalMinor };
  }
  const values = [line.quantity, line.unitPriceMinor, line.lineTotalMinor, line.discountMinor ?? 0];
  if (!values.every(Number.isSafeInteger) || values.some((value) => value < 0)) {
    throw new RangeError('Receipt arithmetic values must be non-negative safe integers');
  }
  const expectedMinor = line.quantity * line.unitPriceMinor - (line.discountMinor ?? 0);
  const differenceMinor = line.lineTotalMinor - expectedMinor;
  return {
    status: differenceMinor === 0 ? 'confirmed' : 'arithmetic-mismatch',
    expectedMinor,
    differenceMinor,
  };
}

export function validateReceiptTotal(lines: readonly ReceiptLineInput[], declaredTotalMinor: number): Readonly<{ expectedMinor: number; differenceMinor: number; valid: boolean }> {
  if (!Number.isSafeInteger(declaredTotalMinor) || declaredTotalMinor < 0) {
    throw new RangeError('Declared total must be a non-negative safe integer');
  }
  const expectedMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
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
