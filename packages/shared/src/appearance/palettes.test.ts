import { describe, expect, it } from 'vitest';
import { contrastRatio, deltaE } from './color.ts';
import { PALETTES } from './palettes.ts';
import { TOKEN_NAMES, type TokenName, type Tokens } from './tokens.ts';

/** [foreground, background, minimum ratio]. 4.5 = WCAG AA body text, 3 = UI parts / large text. */
const PAIRS: Array<[TokenName, TokenName, number]> = [
  ['foreground', 'background', 4.5],
  ['card-foreground', 'card', 4.5],
  ['popover-foreground', 'popover', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['secondary-foreground', 'secondary', 4.5],
  ['muted-foreground', 'muted', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['destructive-foreground', 'destructive', 4.5],
  ['card-foreground', 'flashcard-front', 4.5],
  ['card-foreground', 'flashcard-back', 4.5],
  ['primary', 'background', 3],
  ['ring', 'background', 3],
  ['status-unknown', 'background', 3],
  ['status-recognize', 'background', 3],
  ['status-known', 'background', 3],
  ['status-unknown', 'card', 3],
  ['status-recognize', 'card', 3],
  ['status-known', 'card', 3],
  ['correct', 'card', 3],
  ['incorrect', 'card', 3],
];

const variants = PALETTES.flatMap((p) => [
  { name: `${p.id}/light`, tokens: p.light },
  { name: `${p.id}/dark`, tokens: p.dark },
]);

describe('palettes', () => {
  it('have unique ids', () => {
    const ids = PALETTES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('map each language to at most one palette', () => {
    const langs = PALETTES.flatMap((p) => p.languages);
    expect(new Set(langs).size).toBe(langs.length);
  });

  describe.each(variants)('$name', ({ tokens }: { tokens: Tokens }) => {
    it('defines every token as oklch(L C H)', () => {
      for (const name of TOKEN_NAMES) {
        expect(tokens[name], name).toMatch(/^oklch\([\d.]+ [\d.]+ [\d.]+\)$/);
      }
    });

    it.each(PAIRS)('%s on %s ≥ %d:1', (fg, bg, min) => {
      expect(contrastRatio(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min);
    });

    it('keeps status colors distinguishable from each other and from primary', () => {
      const keys: TokenName[] = ['status-unknown', 'status-recognize', 'status-known', 'primary'];
      for (const [i, a] of keys.entries()) {
        for (const b of keys.slice(i + 1)) {
          expect(deltaE(tokens[a], tokens[b]), `${a} vs ${b}`).toBeGreaterThan(0.08);
        }
      }
    });
  });
});
