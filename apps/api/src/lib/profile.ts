import type { Db, schema } from '@alivocab/db';
import type { ProfileDto } from '@alivocab/shared';
import { ensureLanguage, type LanguageRow, profileRow } from './languages.ts';

/**
 * Returns the user's profile, creating defaults if it is missing. The translation language, voice
 * and daily limits come from the active learning language (PLAN.md D31).
 */
export function getOrCreateProfile(db: Db, userId: string): ProfileDto {
  const row = profileRow(db, userId);
  return toProfileDto(row, ensureLanguage(db, userId, row.targetLang, row));
}

export function toProfileDto(
  row: typeof schema.userProfiles.$inferSelect,
  language: LanguageRow,
): ProfileDto {
  return {
    targetLang: row.targetLang,
    nativeLang: language.nativeLang,
    defaultWordCount: row.defaultWordCount,
    defaultAiSource: row.defaultAiSource,
    ttsProvider: row.ttsProvider,
    ttsVoice: language.ttsVoice,
    dailyNewLimit: language.dailyNewLimit,
    dailyReviewLimit: language.dailyReviewLimit,
    colorPalette: row.colorPalette,
    colorMode: row.colorMode,
    autoPictures: row.autoPictures,
    advancedMode: row.advancedMode,
  };
}
