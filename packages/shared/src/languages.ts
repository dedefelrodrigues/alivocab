import { z } from 'zod';

/** ISO 639-1 language code, lowercase (e.g. `pl`, `en`, `pt`). */
export const languageCodeSchema = z
  .string()
  .regex(/^[a-z]{2}$/, 'Expected an ISO 639-1 code like "pl"');

export type LanguageCode = z.infer<typeof languageCodeSchema>;

export const DEFAULT_TARGET_LANG: LanguageCode = 'pl';
export const DEFAULT_NATIVE_LANG: LanguageCode = 'en';
