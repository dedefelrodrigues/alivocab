import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, MIGRATIONS_DIR, runMigrations, schema } from '@alivocab/db';
import type { ProfileDto, ReviewQueueDto } from '@alivocab/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.ts';

/** A copy of the migrations folder holding only the first `count` migrations. */
function migrationsUpTo(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'alivocab-migrations-'));
  mkdirSync(join(dir, 'meta'));
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify(journal));
  for (const { tag } of journal.entries) {
    copyFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), join(dir, `${tag}.sql`));
  }
  return dir;
}

describe('learning languages backfill', () => {
  it('gives v1.0 learners a row per language they have', () => {
    const db = createDb(':memory:');
    runMigrations(db, migrationsUpTo(5)); // v1.0.0: 0000–0004
    const day = (n: number) => new Date(Date.UTC(2026, 0, n));

    for (const id of ['ana', 'ben', 'cy']) {
      db.insert(schema.user)
        .values({ id, name: id, email: `${id}@test.dev` })
        .run();
    }
    // Ana learned Polish (English translations), then switched to Spanish with Portuguese ones.
    db.insert(schema.userProfiles)
      .values({
        userId: 'ana',
        targetLang: 'es',
        nativeLang: 'pt',
        dailyNewLimit: 7,
        dailyReviewLimit: 70,
        ttsVoice: 'Kore',
      })
      .run();
    const theme = (
      userId: string,
      slug: string,
      targetLang: string,
      nativeLang: string,
      n: number,
    ) =>
      db
        .insert(schema.themes)
        .values({
          userId,
          name: slug,
          slug,
          targetLang,
          nativeLang,
          createdAt: day(n),
          updatedAt: day(n),
        })
        .run();
    theme('ana', 'chleb', 'pl', 'de', 1);
    theme('ana', 'dom', 'pl', 'en', 3);
    theme('ana', 'casa', 'es', 'pt', 5);
    // Her German theme was deleted, but its words and progress stayed.
    const word = db
      .insert(schema.lexemes)
      .values({ lang: 'de', lemma: 'Brot', normalizedLemma: 'brot', pos: 'noun' })
      .returning()
      .get();
    db.insert(schema.userLexemes).values({ userId: 'ana', lexemeId: word.id }).run();
    // Ben has only a profile; Cy has nothing yet.
    db.insert(schema.userProfiles).values({ userId: 'ben' }).run();

    runMigrations(db);

    const rows = db.select().from(schema.userLanguages).all();
    const of = (userId: string, lang: string) =>
      rows.find((r) => r.userId === userId && r.lang === lang);
    expect(rows).toHaveLength(4);
    expect(of('ana', 'es')).toMatchObject({
      nativeLang: 'pt',
      dailyNewLimit: 7,
      dailyReviewLimit: 70,
      ttsVoice: 'Kore',
    });
    // Translated like her most recent Polish theme, with the limits she has today.
    expect(of('ana', 'pl')).toMatchObject({
      nativeLang: 'en',
      dailyNewLimit: 7,
      createdAt: day(1),
      updatedAt: day(3),
    });
    expect(of('ana', 'de')).toMatchObject({ nativeLang: 'pt', dailyNewLimit: 7 });
    expect(of('ben', 'pl')).toMatchObject({ nativeLang: 'en', dailyNewLimit: 20 });
  });
});

describe('active learning language', () => {
  const patch = async (
    call: ReturnType<typeof createTestApp>['call'],
    cookie: string,
    body: Partial<ProfileDto>,
  ) => {
    const res = await call('/api/me/profile', { method: 'PATCH', cookie, body });
    expect(res.status).toBe(200);
    return (await res.json()) as ProfileDto;
  };

  it('starts with a row for the default language', async () => {
    const { call, createUser, db } = createTestApp();
    const cookie = await createUser('a@test.dev');
    const me = (await (await call('/api/me', { cookie })).json()) as { profile: ProfileDto };
    expect(me.profile).toMatchObject({ targetLang: 'pl', nativeLang: 'en', dailyNewLimit: 20 });
    expect(db.select().from(schema.userLanguages).all()).toEqual([
      expect.objectContaining({ lang: 'pl', nativeLang: 'en', archivedAt: null }),
    ]);
  });

  it('keeps settings per language and mirrors the active one into the profile', async () => {
    const { call, createUser, db } = createTestApp();
    const cookie = await createUser('a@test.dev');
    await patch(call, cookie, { nativeLang: 'pt', dailyNewLimit: 12 });

    // Switching to a new language starts it from the current settings.
    expect(await patch(call, cookie, { targetLang: 'es', dailyNewLimit: 5 })).toMatchObject({
      targetLang: 'es',
      nativeLang: 'pt',
      dailyNewLimit: 5,
    });
    await patch(call, cookie, { nativeLang: 'en', ttsVoice: 'Puck' });

    // Back to Polish: its own settings, untouched by the Spanish changes.
    expect(await patch(call, cookie, { targetLang: 'pl' })).toMatchObject({
      targetLang: 'pl',
      nativeLang: 'pt',
      dailyNewLimit: 12,
      ttsVoice: null,
    });
    const language = (lang: string) =>
      db.select().from(schema.userLanguages).where(eq(schema.userLanguages.lang, lang)).get();
    expect(language('es')).toMatchObject({ nativeLang: 'en', dailyNewLimit: 5, ttsVoice: 'Puck' });

    // The old columns follow the active language, so v1.0 reads the right values.
    expect(db.select().from(schema.userProfiles).get()).toMatchObject({
      targetLang: 'pl',
      nativeLang: 'pt',
      dailyNewLimit: 12,
      ttsVoice: null,
    });

    const queue = (await (
      await call('/api/review/queue?tzOffset=0', { cookie })
    ).json()) as ReviewQueueDto;
    expect(queue.limits.newPerDay).toBe(12);
  });
});
