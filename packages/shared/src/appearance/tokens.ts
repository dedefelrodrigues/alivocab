/**
 * Semantic color tokens. Every UI color in the app comes from one of these.
 * Names map 1:1 to CSS custom properties (`--background`, `--status-known`, …) and to
 * Tailwind utilities via `@theme inline` (`bg-background`, `text-status-known`, …).
 */
export const TOKEN_NAMES = [
  // shadcn/ui base tokens
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  // app-specific tokens
  'status-unknown',
  'status-recognize',
  'status-known',
  'correct',
  'incorrect',
  'flashcard-front',
  'flashcard-back',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

/** Token values are CSS `oklch(L C H)` strings (L in 0–1, no alpha). */
export type Tokens = Record<TokenName, string>;

export const COLOR_MODES = ['system', 'light', 'dark'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];
export type ResolvedMode = Exclude<ColorMode, 'system'>;
