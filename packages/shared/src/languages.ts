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

export type LanguageInfo = {
  code: LanguageCode;
  name: string;
  nativeName: string;
  /** Informal greeting for the home page. */
  hello: string;
};

/** Languages offered in pickers. Any ISO 639-1 code is valid in the data model. */
export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'pl', name: 'Polish', nativeName: 'Polski', hello: 'Cześć' },
  { code: 'en', name: 'English', nativeName: 'English', hello: 'Hi' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', hello: 'Olá' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', hello: 'Hola' },
  { code: 'fr', name: 'French', nativeName: 'Français', hello: 'Salut' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', hello: 'Hallo' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', hello: 'Ciao' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', hello: 'Привіт' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', hello: 'Hoi' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', hello: 'Ahoj' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', hello: 'Hej' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', hello: 'Salut' },
];

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase();
}

export function languageHello(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.hello ?? 'Hi';
}
