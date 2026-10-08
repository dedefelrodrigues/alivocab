/**
 * Canonical text form for storage: Unicode NFC, trimmed, inner whitespace collapsed.
 * Diacritics are always preserved (`kość` ≠ `kosc`).
 */
export function normalizeText(input: string): string {
  return input.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

/** Matching / dedupe key: `normalizeText` + locale-aware lowercase. Keeps diacritics. */
export function normalizeKey(input: string, lang: string): string {
  return normalizeText(input).toLocaleLowerCase(lang);
}

/**
 * Strips diacritics for *lenient* answer comparison only. Never use it for storage or
 * dedupe. `ł` has no Unicode decomposition, so it is mapped explicitly.
 */
export function foldDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFC');
}
