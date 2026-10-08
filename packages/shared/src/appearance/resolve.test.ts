import { describe, expect, it } from 'vitest';
import { generatePalettesCss } from './css.ts';
import { resolveMode, resolvePalette } from './resolve.ts';

describe('resolvePalette', () => {
  it('follows the target language in auto mode', () => {
    expect(resolvePalette('auto', 'pl')).toBe('pl');
    expect(resolvePalette('auto', 'PL')).toBe('pl');
  });

  it('falls back to slate for languages without a palette', () => {
    expect(resolvePalette('auto', 'xx')).toBe('slate');
    expect(resolvePalette('auto', undefined)).toBe('slate');
  });

  it('respects a pinned preset regardless of language', () => {
    expect(resolvePalette('slate', 'pl')).toBe('slate');
  });

  it('falls back when a pinned preset no longer exists', () => {
    expect(resolvePalette('removed-preset', 'pl')).toBe('slate');
  });
});

describe('resolveMode', () => {
  it('uses the OS preference in system mode', () => {
    expect(resolveMode('system', true)).toBe('dark');
    expect(resolveMode('system', false)).toBe('light');
  });

  it('ignores the OS preference when pinned', () => {
    expect(resolveMode('light', true)).toBe('light');
    expect(resolveMode('dark', false)).toBe('dark');
  });
});

describe('generatePalettesCss', () => {
  const css = generatePalettesCss();

  it('makes the default palette apply without an attribute', () => {
    expect(css).toContain(":root,\n[data-palette='slate'] {");
    expect(css).toContain(":root.dark,\n.dark[data-palette='slate'] {");
  });

  it('emits light and dark blocks per palette', () => {
    expect(css).toContain("[data-palette='pl'] {");
    expect(css).toContain(".dark[data-palette='pl'] {");
    expect(css).toContain('--status-known:');
  });

  it('maps tokens to Tailwind color utilities', () => {
    expect(css).toContain('@theme inline {');
    expect(css).toContain('--color-status-known: var(--status-known);');
  });
});

describe('oklchToHex', () => {
  it('converts well-known colors', async () => {
    const { oklchToHex } = await import('./color.ts');
    expect(oklchToHex('oklch(1 0 0)')).toBe('#ffffff');
    expect(oklchToHex('oklch(0 0 0)')).toBe('#000000');
    // sRGB primaries expressed in OKLCH
    expect(oklchToHex('oklch(0.62796 0.25768 29.234)')).toBe('#ff0000');
    expect(oklchToHex('oklch(0.51975 0.17686 142.495)')).toBe('#008000');
    expect(oklchToHex('oklch(0.45201 0.31321 264.052)')).toBe('#0000ff');
  });
});
