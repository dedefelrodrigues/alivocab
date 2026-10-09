import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import type { ProfileDto } from '@alivocab/shared';
import { eq } from 'drizzle-orm';

/** Returns the user's profile, creating defaults if it is missing. */
export function getOrCreateProfile(db: Db, userId: string): ProfileDto {
  db.insert(schema.userProfiles).values({ userId }).onConflictDoNothing().run();
  const row = db
    .select()
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, userId))
    .get();
  if (!row) throw new Error('Profile missing after upsert');
  return toProfileDto(row);
}

export function toProfileDto(row: typeof schema.userProfiles.$inferSelect): ProfileDto {
  return {
    targetLang: row.targetLang,
    nativeLang: row.nativeLang,
    defaultWordCount: row.defaultWordCount,
    defaultAiSource: row.defaultAiSource,
    ttsProvider: row.ttsProvider,
    ttsVoice: row.ttsVoice,
    dailyNewLimit: row.dailyNewLimit,
    dailyReviewLimit: row.dailyReviewLimit,
    colorPalette: row.colorPalette,
    colorMode: row.colorMode,
    autoPictures: row.autoPictures,
    advancedMode: row.advancedMode,
  };
}
