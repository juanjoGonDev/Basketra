export function normalizeSearchText(value) {
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es-ES');
}
