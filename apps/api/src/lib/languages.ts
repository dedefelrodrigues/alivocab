/**
 * Learning languages (PLAN.md D31): one `user_languages` row per language a user learns, holding
 * the settings that differ per language. The profile's `targetLang` is the active one.
 */
import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import { and, eq } from 'drizzle-orm';

const { userLanguages, userProfiles } = schema;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbLike = Db | Tx;
export type LanguageRow = typeof userLanguages.$inferSelect;
/** Settings stored per learning language (the profile keeps a mirror until v1.2). */
export type LanguageSettings = Pick<
  LanguageRow,
  'nativeLang' | 'dailyNewLimit' | 'dailyReviewLimit' | 'ttsVoice'
>;

/** Only the per-language fields of `source` (undefined ones are skipped by Drizzle's `set`). */
function languageSettings(source: Partial<LanguageSettings>): Partial<LanguageSettings> {
  const { nativeLang, dailyNewLimit, dailyReviewLimit, ttsVoice } = source;
  return { nativeLang, dailyNewLimit, dailyReviewLimit, ttsVoice };
}

export function getLanguage(db: DbLike, userId: string, lang: string): LanguageRow | undefined {
  return db
    .select()
    .from(userLanguages)
    .where(and(eq(userLanguages.userId, userId), eq(userLanguages.lang, lang)))
    .get();
}

/** Returns the row for `lang`, creating it from `defaults` when the user doesn't learn it yet. */
export function ensureLanguage(
  db: DbLike,
  userId: string,
  lang: string,
  defaults: LanguageSettings,
): LanguageRow {
  db.insert(userLanguages)
    .values({ userId, lang, ...languageSettings(defaults), nativeLang: defaults.nativeLang })
    .onConflictDoNothing()
    .run();
  const row = getLanguage(db, userId, lang);
  if (!row) throw new Error('Learning language missing after upsert');
  return row;
}

/**
 * Applies a profile update to the active language: creates its row when the update switched to a
 * new language, stores the per-language settings on it, then copies them back into the old profile
 * columns so v1.0 still reads the right values after a rollback (removed in v1.2).
 */
export function syncActiveLanguage(
  db: DbLike,
  userId: string,
  patch: Partial<LanguageSettings>,
): LanguageRow {
  const profile = db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).get();
  if (!profile) throw new Error('Profile missing');
  const where = and(eq(userLanguages.userId, userId), eq(userLanguages.lang, profile.targetLang));
  ensureLanguage(db, userId, profile.targetLang, profile);
  const settings = languageSettings(patch);
  if (Object.values(settings).some((v) => v !== undefined)) {
    db.update(userLanguages).set(settings).where(where).run();
  }
  const active = getLanguage(db, userId, profile.targetLang);
  if (!active) throw new Error('Learning language missing');
  db.update(userProfiles)
    .set(languageSettings(active))
    .where(eq(userProfiles.userId, userId))
    .run();
  return active;
}
