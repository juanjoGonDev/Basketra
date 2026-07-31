const EURO_FORMATTER = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function assertMinorUnits(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('El importe debe ser un entero no negativo en unidades menores');
  }
}

export function formatEuroMinor(value) {
  assertMinorUnits(value);
  return EURO_FORMATTER.format(value / 100);
}

export function minorToEuroInput(value) {
  assertMinorUnits(value);
  const euros = Math.floor(value / 100);
  const cents = String(value % 100).padStart(2, '0');
  return `${euros}.${cents}`;
}

export function euroInputToMinor(input) {
  const normalized = String(input).trim().replace(/\s|€/gu, '').replace(',', '.');
  const match = /^(\d+)(?:\.(\d{0,2}))?$/u.exec(normalized);
  if (!match) throw new RangeError('Introduce un importe en euros con hasta dos decimales');
  const euros = Number(match[1]);
  const cents = Number((match[2] || '').padEnd(2, '0'));
  const minor = euros * 100 + cents;
  if (!Number.isSafeInteger(minor)) throw new RangeError('El importe es demasiado grande');
  return minor;
}
