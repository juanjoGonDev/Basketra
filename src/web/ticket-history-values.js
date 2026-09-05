const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const PERCENTAGE_PATTERN = /^(\d{1,3})(?:[.,](\d{1,2}))?$/u;

export function localDateBoundaryIso(value, { endOfDay = false } = {}) {
  const match = LOCAL_DATE_PATTERN.exec(String(value).trim());
  if (!match) throw new RangeError('La fecha debe usar el formato AAAA-MM-DD.');

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = endOfDay
    ? new Date(year, monthIndex, day, 23, 59, 59, 999)
    : new Date(year, monthIndex, day, 0, 0, 0, 0);

  if (
    date.getFullYear() !== year
    || date.getMonth() !== monthIndex
    || date.getDate() !== day
  ) {
    throw new RangeError('La fecha no existe en el calendario local.');
  }
  return date.toISOString();
}

export function parsePercentageBasisPoints(value) {
  const normalized = String(value).trim();
  const match = PERCENTAGE_PATTERN.exec(normalized);
  if (!match) throw new RangeError('El porcentaje admite hasta dos decimales.');

  const whole = Number(match[1]);
  const fractional = Number((match[2] || '').padEnd(2, '0'));
  const basisPoints = whole * 100 + fractional;
  if (!Number.isSafeInteger(basisPoints) || basisPoints > 10_000) {
    throw new RangeError('El porcentaje debe estar entre 0 y 100.');
  }
  return basisPoints;
}
