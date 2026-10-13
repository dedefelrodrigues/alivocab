/**
 * Learning languages (PLAN.md D31): one `user_languages` row per language a user learns, holding
 * the settings that differ per language. The profile's `targetLang` is the active one.
 */
import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import { type LearningLanguageDto, languageName } from '@alivocab/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';

const { themes, userLanguages, userProfiles } = schema;

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

const notLearning = (lang: string) =>
  new HTTPException(404, { message: `You aren't learning ${languageName(lang)}` });

/** The user's profile row, created with defaults when missing. */
export function profileRow(db: DbLike, userId: string) {
  db.insert(userProfiles).values({ userId }).onConflictDoNothing().run();
  const row = db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).get();
  if (!row) throw new Error('Profile missing after upsert');
  return row;
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

/** The active language's row (created from the profile when missing). */
export function activeLanguage(db: DbLike, userId: string): LanguageRow {
  const profile = profileRow(db, userId);
  return ensureLanguage(db, userId, profile.targetLang, profile);
}

/**
 * The language a request is about: the theme's when there is one (404 for someone else's theme),
 * else `lang`, else the active language. A language the user doesn't learn is a 404.
 */
export function requestLanguage(
  db: DbLike,
  userId: string,
  opts: { themeId?: string; lang?: string },
): LanguageRow {
  const active = activeLanguage(db, userId);
  if (opts.themeId) {
    const theme = db
      .select({ targetLang: themes.targetLang, nativeLang: themes.nativeLang })
      .from(themes)
      .where(and(eq(themes.id, opts.themeId), eq(themes.userId, userId)))
      .get();
    if (!theme) throw new HTTPException(404, { message: 'Theme not found' });
    // Every theme's language has a row (backfill, theme creation); this only guards odd data.
    return ensureLanguage(db, userId, theme.targetLang, {
      ...active,
      nativeLang: theme.nativeLang,
    });
  }
  const lang = opts.lang ?? active.lang;
  if (lang === active.lang) return active;
  const row = getLanguage(db, userId, lang);
  if (!row) throw notLearning(lang);
  return row;
}

/** The translation language for words of each learning language (default: the active one's). */
export function nativeLangs(db: DbLike, userId: string): (lang: string) => string {
  const active = activeLanguage(db, userId);
  const byLang = new Map(
    db
      .select({ lang: userLanguages.lang, nativeLang: userLanguages.nativeLang })
      .from(userLanguages)
      .where(eq(userLanguages.userId, userId))
      .all()
      .map((r) => [r.lang, r.nativeLang]),
  );
  return (lang) => byLang.get(lang) ?? active.nativeLang;
}

export function toLanguageDto(row: LanguageRow, activeLang: string): LearningLanguageDto {
  return {
    lang: row.lang,
    nativeLang: row.nativeLang,
    dailyNewLimit: row.dailyNewLimit,
    dailyReviewLimit: row.dailyReviewLimit,
    ttsVoice: row.ttsVoice,
    active: row.lang === activeLang,
    archived: row.archivedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function listLanguages(db: DbLike, userId: string): LearningLanguageDto[] {
  const active = activeLanguage(db, userId);
  return (
    db
      .select()
      .from(userLanguages)
      .where(eq(userLanguages.userId, userId))
      // In the order they were added (rowid breaks ties within a millisecond).
      .orderBy(asc(userLanguages.createdAt), sql`rowid`)
      .all()
      .map((row) => toLanguageDto(row, active.lang))
  );
}

/**
 * Starts learning `lang` with the active language's limits, or brings it back if it was archived.
 * Its voice starts empty: the provider's default voice for the language.
 */
export function addLanguage(
  db: DbLike,
  userId: string,
  input: { lang: string; nativeLang?: string },
): { row: LanguageRow; created: boolean } {
  const existing = getLanguage(db, userId, input.lang);
  if (existing) {
    const restored = existing.archivedAt
      ? db
          .update(userLanguages)
          .set({ archivedAt: null })
          .where(and(eq(userLanguages.userId, userId), eq(userLanguages.lang, input.lang)))
          .returning()
          .get()
      : existing;
    return {
      row: input.nativeLang
        ? updateLanguage(db, userId, input.lang, { nativeLang: input.nativeLang })
        : (restored ?? existing),
      created: false,
    };
  }
  const active = activeLanguage(db, userId);
  const nativeLang = input.nativeLang ?? active.nativeLang;
  if (nativeLang === input.lang) {
    throw new HTTPException(400, {
      message: `Choose which language translations of ${languageName(input.lang)} should be in`,
    });
  }
  const row = ensureLanguage(db, userId, input.lang, { ...active, nativeLang, ttsVoice: null });
  return { row, created: true };
}

/**
 * Changes a language's settings. A new translation language also applies to the language's themes;
 * changes to the active language are mirrored into the old profile columns (removed in v1.2).
 */
export function updateLanguage(
  db: DbLike,
  userId: string,
  lang: string,
  patch: Partial<LanguageSettings>,
): LanguageRow {
  const where = and(eq(userLanguages.userId, userId), eq(userLanguages.lang, lang));
  const before = getLanguage(db, userId, lang);
  if (!before) throw notLearning(lang);
  if (patch.nativeLang === lang) {
    throw new HTTPException(400, { message: 'Translations need to be in another language' });
  }
  const settings = languageSettings(patch);
  if (Object.values(settings).some((v) => v !== undefined)) {
    db.update(userLanguages).set(settings).where(where).run();
  }
  if (settings.nativeLang && settings.nativeLang !== before.nativeLang) {
    db.update(themes)
      // Keep `updatedAt`: the theme list is ordered by it, and the theme itself didn't change.
      .set({ nativeLang: settings.nativeLang, updatedAt: sql`${themes.updatedAt}` })
      .where(and(eq(themes.userId, userId), eq(themes.targetLang, lang)))
      .run();
  }
  const row = getLanguage(db, userId, lang);
  if (!row) throw notLearning(lang);
  if (profileRow(db, userId).targetLang === lang) {
    db.update(userProfiles).set(languageSettings(row)).where(eq(userProfiles.userId, userId)).run();
  }
  return row;
}

/** Hides a language from the switcher. Its themes, words and progress are kept. */
export function archiveLanguage(db: DbLike, userId: string, lang: string): void {
  if (!getLanguage(db, userId, lang)) throw notLearning(lang);
  if (profileRow(db, userId).targetLang === lang) {
    throw new HTTPException(400, {
      message: 'Switch to another language before removing this one',
    });
  }
  db.update(userLanguages)
    .set({ archivedAt: new Date() })
    .where(and(eq(userLanguages.userId, userId), eq(userLanguages.lang, lang)))
    .run();
}

/**
 * Applies a profile update to the active language: creates its row (or brings back an archived
 * one) when the update switched languages, then stores the per-language settings on it.
 */
export function syncActiveLanguage(
  db: DbLike,
  userId: string,
  patch: Partial<LanguageSettings>,
): LanguageRow {
  const profile = profileRow(db, userId);
  const active = ensureLanguage(db, userId, profile.targetLang, profile);
  if (active.archivedAt) {
    db.update(userLanguages)
      .set({ archivedAt: null })
      .where(and(eq(userLanguages.userId, userId), eq(userLanguages.lang, active.lang)))
      .run();
  }
  return updateLanguage(db, userId, active.lang, patch);
}
