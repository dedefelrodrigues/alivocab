import type { Tokens } from './tokens.ts';

export type Palette = {
  id: string;
  label: string;
  /** Short description shown under the swatch in settings. */
  description: string;
  /** ISO 639-1 target languages this palette is the `auto` choice for. */
  languages: readonly string[];
  light: Tokens;
  dark: Tokens;
};

/**
 * Neutral fallback palette: slate surfaces with an indigo primary.
 */
const slate: Palette = {
  id: 'slate',
  label: 'Slate',
  description: 'Neutral slate with indigo accents',
  languages: [],
  light: {
    background: 'oklch(1 0 0)',
    foreground: 'oklch(0.208 0.042 265.755)',
    card: 'oklch(1 0 0)',
    'card-foreground': 'oklch(0.208 0.042 265.755)',
    popover: 'oklch(1 0 0)',
    'popover-foreground': 'oklch(0.208 0.042 265.755)',
    primary: 'oklch(0.511 0.262 276.966)',
    'primary-foreground': 'oklch(0.984 0.003 247.858)',
    secondary: 'oklch(0.968 0.007 247.896)',
    'secondary-foreground': 'oklch(0.208 0.042 265.755)',
    muted: 'oklch(0.968 0.007 247.896)',
    'muted-foreground': 'oklch(0.446 0.043 257.281)',
    accent: 'oklch(0.962 0.018 272.314)',
    'accent-foreground': 'oklch(0.359 0.144 278.697)',
    destructive: 'oklch(0.577 0.245 27.325)',
    'destructive-foreground': 'oklch(0.985 0 0)',
    border: 'oklch(0.929 0.013 255.508)',
    input: 'oklch(0.869 0.022 252.894)',
    ring: 'oklch(0.585 0.233 277.117)',
    'chart-1': 'oklch(0.511 0.262 276.966)',
    'chart-2': 'oklch(0.6 0.118 184.704)',
    'chart-3': 'oklch(0.666 0.179 58.318)',
    'chart-4': 'oklch(0.586 0.253 17.585)',
    'chart-5': 'oklch(0.588 0.158 241.966)',
    'status-unknown': 'oklch(0.577 0.245 27.325)',
    'status-recognize': 'oklch(0.62 0.17 55)',
    'status-known': 'oklch(0.58 0.17 149)',
    correct: 'oklch(0.58 0.17 149)',
    incorrect: 'oklch(0.577 0.245 27.325)',
    'flashcard-front': 'oklch(1 0 0)',
    'flashcard-back': 'oklch(0.984 0.003 247.858)',
  },
  dark: {
    background: 'oklch(0.129 0.042 264.695)',
    foreground: 'oklch(0.984 0.003 247.858)',
    card: 'oklch(0.208 0.042 265.755)',
    'card-foreground': 'oklch(0.984 0.003 247.858)',
    popover: 'oklch(0.208 0.042 265.755)',
    'popover-foreground': 'oklch(0.984 0.003 247.858)',
    primary: 'oklch(0.673 0.182 276.935)',
    'primary-foreground': 'oklch(0.129 0.042 264.695)',
    secondary: 'oklch(0.279 0.041 260.031)',
    'secondary-foreground': 'oklch(0.984 0.003 247.858)',
    muted: 'oklch(0.279 0.041 260.031)',
    'muted-foreground': 'oklch(0.704 0.04 256.788)',
    accent: 'oklch(0.3 0.07 277)',
    'accent-foreground': 'oklch(0.93 0.034 272.788)',
    destructive: 'oklch(0.637 0.237 25.331)',
    'destructive-foreground': 'oklch(0.129 0.042 264.695)',
    border: 'oklch(0.279 0.041 260.031)',
    input: 'oklch(0.372 0.044 257.287)',
    ring: 'oklch(0.673 0.182 276.935)',
    'chart-1': 'oklch(0.673 0.182 276.935)',
    'chart-2': 'oklch(0.777 0.152 181.912)',
    'chart-3': 'oklch(0.828 0.189 84.429)',
    'chart-4': 'oklch(0.712 0.194 13.428)',
    'chart-5': 'oklch(0.746 0.16 232.661)',
    'status-unknown': 'oklch(0.704 0.191 22.216)',
    'status-recognize': 'oklch(0.828 0.189 84.429)',
    'status-known': 'oklch(0.792 0.209 151.711)',
    correct: 'oklch(0.792 0.209 151.711)',
    incorrect: 'oklch(0.704 0.191 22.216)',
    'flashcard-front': 'oklch(0.208 0.042 265.755)',
    'flashcard-back': 'oklch(0.279 0.041 260.031)',
  },
};

/**
 * Polish palette, inspired by the biało-czerwona flag: crimson primary on warm white.
 * The red is the primary/brand color, not a surface color. "Unknown" and "incorrect" shift
 * toward magenta so they stay distinguishable from the brand red.
 */
const pl: Palette = {
  id: 'pl',
  label: 'Polski',
  description: 'Crimson and warm white, inspired by the Polish flag',
  languages: ['pl'],
  light: {
    background: 'oklch(0.988 0.004 60)',
    foreground: 'oklch(0.22 0.025 20)',
    card: 'oklch(1 0 0)',
    'card-foreground': 'oklch(0.22 0.025 20)',
    popover: 'oklch(1 0 0)',
    'popover-foreground': 'oklch(0.22 0.025 20)',
    primary: 'oklch(0.52 0.2 25)',
    'primary-foreground': 'oklch(0.99 0.004 60)',
    secondary: 'oklch(0.955 0.016 25)',
    'secondary-foreground': 'oklch(0.32 0.09 25)',
    muted: 'oklch(0.962 0.008 40)',
    'muted-foreground': 'oklch(0.45 0.03 20)',
    accent: 'oklch(0.94 0.03 20)',
    'accent-foreground': 'oklch(0.32 0.09 25)',
    destructive: 'oklch(0.46 0.17 15)',
    'destructive-foreground': 'oklch(0.99 0.004 60)',
    border: 'oklch(0.91 0.012 30)',
    input: 'oklch(0.86 0.02 30)',
    ring: 'oklch(0.55 0.2 25)',
    'chart-1': 'oklch(0.52 0.2 25)',
    'chart-2': 'oklch(0.5 0.08 250)',
    'chart-3': 'oklch(0.68 0.16 70)',
    'chart-4': 'oklch(0.55 0.1 180)',
    'chart-5': 'oklch(0.6 0.17 350)',
    'status-unknown': 'oklch(0.54 0.21 355)',
    'status-recognize': 'oklch(0.62 0.16 60)',
    'status-known': 'oklch(0.56 0.15 150)',
    correct: 'oklch(0.56 0.15 150)',
    incorrect: 'oklch(0.54 0.21 355)',
    'flashcard-front': 'oklch(1 0 0)',
    'flashcard-back': 'oklch(0.97 0.012 25)',
  },
  dark: {
    background: 'oklch(0.17 0.015 20)',
    foreground: 'oklch(0.97 0.005 40)',
    card: 'oklch(0.215 0.02 20)',
    'card-foreground': 'oklch(0.97 0.005 40)',
    popover: 'oklch(0.215 0.02 20)',
    'popover-foreground': 'oklch(0.97 0.005 40)',
    primary: 'oklch(0.66 0.19 22)',
    'primary-foreground': 'oklch(0.17 0.015 20)',
    secondary: 'oklch(0.28 0.04 20)',
    'secondary-foreground': 'oklch(0.97 0.005 40)',
    muted: 'oklch(0.27 0.02 20)',
    'muted-foreground': 'oklch(0.74 0.03 30)',
    accent: 'oklch(0.3 0.06 20)',
    'accent-foreground': 'oklch(0.97 0.005 40)',
    destructive: 'oklch(0.68 0.2 15)',
    'destructive-foreground': 'oklch(0.17 0.015 20)',
    border: 'oklch(0.3 0.02 20)',
    input: 'oklch(0.38 0.025 20)',
    ring: 'oklch(0.66 0.19 22)',
    'chart-1': 'oklch(0.66 0.19 22)',
    'chart-2': 'oklch(0.72 0.09 250)',
    'chart-3': 'oklch(0.8 0.15 80)',
    'chart-4': 'oklch(0.74 0.1 180)',
    'chart-5': 'oklch(0.72 0.17 350)',
    'status-unknown': 'oklch(0.72 0.18 355)',
    'status-recognize': 'oklch(0.82 0.15 80)',
    'status-known': 'oklch(0.78 0.17 150)',
    correct: 'oklch(0.78 0.17 150)',
    incorrect: 'oklch(0.72 0.18 355)',
    'flashcard-front': 'oklch(0.215 0.02 20)',
    'flashcard-back': 'oklch(0.26 0.03 20)',
  },
};

export const DEFAULT_PALETTE_ID = 'slate';

export const PALETTES: readonly Palette[] = [slate, pl];

export function getPalette(id: string): Palette | undefined {
  return PALETTES.find((p) => p.id === id);
}
