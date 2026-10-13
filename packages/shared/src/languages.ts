import { z } from 'zod';

/** ISO 639-1 language code, lowercase (e.g. `pl`, `en`, `pt`). */
export const languageCodeSchema = z
  .string()
  .regex(/^[a-z]{2}$/, 'Expected an ISO 639-1 code like "pl"');

export type LanguageCode = z.infer<typeof languageCodeSchema>;

/**
 * The learning language a request is about (PLAN.md D31). Defaults to the active language;
 * requests about a theme use the theme's language instead.
 */
export const learningLangParam = languageCodeSchema.optional();

export const DEFAULT_TARGET_LANG: LanguageCode = 'pl';
export const DEFAULT_NATIVE_LANG: LanguageCode = 'en';

export type LanguageInfo = { code: LanguageCode; name: string; nativeName: string };

/** Languages offered in pickers. Any ISO 639-1 code is valid in the data model. */
export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română' },
];

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase();
}
