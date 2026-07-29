export type Money = Readonly<{ currency: 'EUR'; minor: number }>;

export function money(minor: number): Money {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new RangeError('Money minor units must be a non-negative safe integer');
  }
  return { currency: 'EUR', minor };
}

export function parseEuroMinor(input: string): Money {
  const normalized = input.trim().replace(/\s/g, '').replace('€', '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new RangeError('Invalid EUR amount');
  }
  const [whole = '0', decimals = ''] = normalized.split('.');
  return money(Number(whole) * 100 + Number(decimals.padEnd(2, '0')));
}

export function addMoney(...values: Money[]): Money {
  return money(values.reduce((total, value) => total + value.minor, 0));
}

export function subtractMoney(left: Money, right: Money): Money {
  if (right.minor > left.minor) {
    throw new RangeError('Money subtraction cannot produce a negative value');
  }
  return money(left.minor - right.minor);
}

export function multiplyMoney(value: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError('Quantity must be a non-negative safe integer');
  }
  return money(value.minor * quantity);
}

export function formatMoney(value: Money): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: value.currency }).format(value.minor / 100);
}
