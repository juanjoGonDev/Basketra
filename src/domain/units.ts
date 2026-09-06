export const UNIT_VALUES = ['g', 'kg', 'ml', 'l', 'unit', 'pack', 'roll', 'sheet', 'capsule', 'dose', 'wash', 'm'] as const;

export type Unit = typeof UNIT_VALUES[number];
export type BaseUnit = 'g' | 'ml' | 'unit' | 'pack' | 'roll' | 'sheet' | 'capsule' | 'dose' | 'wash' | 'm';
export type Rational = Readonly<{ numerator: number; denominator: number }>;
export type Quantity = Readonly<{ amount: Rational; unit: Unit }>;

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

export function rational(numerator: number, denominator = 1): Rational {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0 || numerator < 0) {
    throw new RangeError('Rational values require non-negative integer numerator and positive denominator');
  }
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

export function parseDecimalRational(input: string): Rational {
  const normalized = input.trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new RangeError('Invalid decimal quantity');
  }
  const [whole = '0', fractional = ''] = normalized.split('.');
  const denominator = 10 ** fractional.length;
  return rational(Number(whole) * denominator + Number(fractional || '0'), denominator);
}

export function multiplyRational(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

export function divideRational(left: Rational, right: Rational): Rational {
  if (right.numerator === 0) {
    throw new RangeError('Cannot divide by zero');
  }
  return rational(left.numerator * right.denominator, left.denominator * right.numerator);
}

export function normalizeQuantity(quantity: Quantity): Readonly<{ amount: Rational; unit: BaseUnit }> {
  switch (quantity.unit) {
    case 'kg':
      return { amount: multiplyRational(quantity.amount, rational(1000)), unit: 'g' };
    case 'l':
      return { amount: multiplyRational(quantity.amount, rational(1000)), unit: 'ml' };
    case 'g':
    case 'ml':
    case 'unit':
    case 'pack':
    case 'roll':
    case 'sheet':
    case 'capsule':
    case 'dose':
    case 'wash':
    case 'm':
      return { amount: quantity.amount, unit: quantity.unit };
  }
}

export function ensureComparable(left: Quantity, right: Quantity): void {
  if (normalizeQuantity(left).unit !== normalizeQuantity(right).unit) {
    throw new RangeError('Quantities are not semantically comparable');
  }
}

export function normalizedMinorPerBaseUnit(totalMinor: number, quantity: Quantity): Rational {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
    throw new RangeError('Price must be a non-negative safe integer');
  }
  const normalized = normalizeQuantity(quantity);
  if (normalized.amount.numerator === 0) {
    throw new RangeError('Quantity must be greater than zero');
  }
  return divideRational(rational(totalMinor), normalized.amount);
}

export function roundRationalHalfUp(value: Rational): number {
  const quotient = Math.floor(value.numerator / value.denominator);
  const remainder = value.numerator % value.denominator;
  return quotient + (remainder * 2 >= value.denominator ? 1 : 0);
}

export function normalizedMinorPerDisplayUnit(
  totalMinor: number,
  quantity: Quantity,
): Readonly<{ minor: number; unit: Unit }> {
  const perBaseUnit = normalizedMinorPerBaseUnit(totalMinor, quantity);
  const baseUnit = normalizeQuantity(quantity).unit;
  if (baseUnit === 'g') {
    return { minor: roundRationalHalfUp(multiplyRational(perBaseUnit, rational(1000))), unit: 'kg' };
  }
  if (baseUnit === 'ml') {
    return { minor: roundRationalHalfUp(multiplyRational(perBaseUnit, rational(1000))), unit: 'l' };
  }
  return { minor: roundRationalHalfUp(perBaseUnit), unit: baseUnit };
}

export function compareRational(left: Rational, right: Rational): number {
  const lhs = left.numerator * right.denominator;
  const rhs = right.numerator * left.denominator;
  return lhs === rhs ? 0 : lhs < rhs ? -1 : 1;
}
