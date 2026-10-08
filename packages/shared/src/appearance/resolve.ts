import { DEFAULT_PALETTE_ID, getPalette, PALETTES } from './palettes.ts';
import type { ColorMode, ResolvedMode } from './tokens.ts';

/** `'auto'` follows the user's target language. Any other value is a preset id. */
export type PaletteSetting = 'auto' | (string & {});

/**
 * Picks the palette id to apply. Unknown ids (e.g. a preset that was removed) fall back to
 * the default rather than breaking the UI.
 */
export function resolvePalette(setting: PaletteSetting, targetLang: string | undefined): string {
  if (setting !== 'auto') {
    return getPalette(setting) ? setting : DEFAULT_PALETTE_ID;
  }
  const lang = targetLang?.toLowerCase();
  const match = lang ? PALETTES.find((p) => p.languages.includes(lang)) : undefined;
  return match?.id ?? DEFAULT_PALETTE_ID;
}

export function resolveMode(mode: ColorMode, prefersDark: boolean): ResolvedMode {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}
