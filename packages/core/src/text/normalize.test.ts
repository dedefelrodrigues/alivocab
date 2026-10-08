import { describe, expect, it } from 'vitest';
import { foldDiacritics, normalizeKey, normalizeText } from './normalize.ts';

describe('normalizeText', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeText('  dzień \t dobry \n')).toBe('dzień dobry');
  });

  it('composes decomposed characters (NFD → NFC)', () => {
    const decomposed = 'kość'; // s + combining acute, c + combining acute
    expect(normalizeText(decomposed)).toBe('kość');
  });
});

describe('normalizeKey', () => {
  it('lowercases but keeps diacritics', () => {
    expect(normalizeKey('Żółw', 'pl')).toBe('żółw');
    expect(normalizeKey('kość', 'pl')).not.toBe(normalizeKey('kosc', 'pl'));
  });
});

describe('foldDiacritics', () => {
  it('removes all Polish diacritics including ł', () => {
    expect(foldDiacritics('Zażółć gęślą jaźń')).toBe('Zazolc gesla jazn');
    expect(foldDiacritics('Łódź')).toBe('Lodz');
  });
});
