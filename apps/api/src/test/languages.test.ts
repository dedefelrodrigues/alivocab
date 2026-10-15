import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, MIGRATIONS_DIR, runMigrations, schema } from '@alivocab/db';
import type {
  LearningLanguageDto,
  LessonDto,
  MeDto,
  ProfileDto,
  ReviewQueueDto,
  ReviewSummaryDto,
  StatsDto,
  ThemeSummaryDto,
} from '@alivocab/shared';
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

// ── Several languages side by side ──────────────────────────────────────────

const w = (lemma: string) => ({
  lemma,
  pos: 'noun',
  translations: [`${lemma}-tr`],
  status: 'unknown',
});

async function json<T>(res: Response | Promise<Response>): Promise<T> {
  return (await (await res).json()) as T;
}

/** Polish (active, English translations) and Spanish (Portuguese translations), a theme each. */
async function twoLanguages() {
  const ctx = createTestApp();
  const cookie = await ctx.createUser('a@test.dev');
  const added = await ctx.call('/api/languages', {
    method: 'POST',
    cookie,
    body: { lang: 'es', nativeLang: 'pt' },
  });
  expect(added.status).toBe(201);
  const theme = (body: object) =>
    json<ThemeSummaryDto>(ctx.call('/api/themes', { method: 'POST', cookie, body }));
  const pl = await theme({ name: 'Dom', words: [w('dom'), w('kot')] });
  const es = await theme({ name: 'Casa', lang: 'es', words: [w('casa'), w('gato'), w('perro')] });
  const get = <T>(path: string) => json<T>(ctx.call(path, { cookie }));
  const send = (method: string, path: string, body?: unknown) =>
    ctx.call(path, { method, cookie, body });
  const lexemeId = (lemma: string) =>
    ctx.db.select().from(schema.lexemes).where(eq(schema.lexemes.lemma, lemma)).get()?.id ?? '';
  return { ...ctx, cookie, pl, es, get, send, lexemeId };
}

const lemmas = (cards: { lemma: string }[]) => [...new Set(cards.map((c) => c.lemma))].sort();

describe('learning languages API', () => {
  it('adds, updates, archives and restores languages', async () => {
    const { get, send, call, createUser } = await twoLanguages();
    expect(await get<LearningLanguageDto[]>('/api/languages')).toMatchObject([
      { lang: 'pl', nativeLang: 'en', active: true, archived: false },
      { lang: 'es', nativeLang: 'pt', active: false, dailyNewLimit: 20, ttsVoice: null },
    ]);
    expect((await get<MeDto>('/api/me')).languages).toHaveLength(2);

    expect((await send('POST', '/api/languages', { lang: 'es' })).status).toBe(200);
    expect((await send('POST', '/api/languages', { lang: 'fr', nativeLang: 'fr' })).status).toBe(
      400,
    );
    // Translations would default to English, the language itself.
    expect((await send('POST', '/api/languages', { lang: 'en' })).status).toBe(400);

    const updated = await send('PATCH', '/api/languages/es', {
      dailyNewLimit: 3,
      ttsVoice: 'Puck',
    });
    expect(await updated.json()).toMatchObject({ lang: 'es', dailyNewLimit: 3, ttsVoice: 'Puck' });
    expect((await send('PATCH', '/api/languages/es', { nativeLang: 'es' })).status).toBe(400);
    expect((await send('PATCH', '/api/languages/fr', { dailyNewLimit: 3 })).status).toBe(404);
    expect((await send('PATCH', '/api/languages/xyz', { dailyNewLimit: 3 })).status).toBe(400);

    expect((await send('DELETE', '/api/languages/pl')).status).toBe(400);
    expect((await send('DELETE', '/api/languages/es')).status).toBe(204);
    expect((await get<LearningLanguageDto[]>('/api/languages'))[1]).toMatchObject({
      lang: 'es',
      archived: true,
    });
    // Coming back keeps the settings.
    const restored = await send('POST', '/api/languages', { lang: 'es' });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ archived: false, dailyNewLimit: 3 });

    // Another learner has only their own default language.
    const bob = await createUser('bob@test.dev');
    expect(await json(call('/api/languages', { cookie: bob }))).toMatchObject([{ lang: 'pl' }]);
    expect((await call('/api/languages/es', { method: 'DELETE', cookie: bob })).status).toBe(404);
  });

  it('creates and lists themes per language', async () => {
    const { pl, es, get, send } = await twoLanguages();
    expect(pl).toMatchObject({ targetLang: 'pl', nativeLang: 'en' });
    expect(es).toMatchObject({ targetLang: 'es', nativeLang: 'pt' });
    expect((await get<ThemeSummaryDto[]>('/api/themes')).map((t) => t.name)).toEqual(['Dom']);
    expect((await get<ThemeSummaryDto[]>('/api/themes?lang=es')).map((t) => t.name)).toEqual([
      'Casa',
    ]);
    expect((await send('GET', '/api/themes?lang=fr')).status).toBe(404);
    expect((await send('POST', '/api/themes', { name: 'Maison', lang: 'fr' })).status).toBe(404);
  });

  it('starts every language on the default voice when the provider changes', async () => {
    const { get, send } = await twoLanguages();
    await send('PATCH', '/api/languages/es', { ttsVoice: 'Puck' });
    await send('PATCH', '/api/me/profile', { ttsVoice: 'Kore' });
    await send('PATCH', '/api/me/profile', { ttsProvider: 'edge' });
    const languages = await get<LearningLanguageDto[]>('/api/languages');
    expect(languages.map((l) => l.ttsVoice)).toEqual([null, null]);
  });

  it('applies a new translation language to the language’s themes', async () => {
    const { es, get, send } = await twoLanguages();
    await send('PATCH', '/api/languages/es', { nativeLang: 'en' });
    const [theme] = await get<ThemeSummaryDto[]>('/api/themes?lang=es');
    expect(theme).toMatchObject({ nativeLang: 'en', updatedAt: es.updatedAt });
  });

  it('builds proposal prompts for the requested language', async () => {
    const { send } = await twoLanguages();
    const res = await send('POST', '/api/generate/prompt', {
      themeName: 'Food',
      count: 10,
      lang: 'es',
    });
    const { prompt } = (await res.json()) as { prompt: string };
    expect(prompt).toContain('Spanish');
    expect(prompt).toContain('Portuguese');
    expect(prompt).not.toContain('Polish');
  });
});

describe('scoped by language', () => {
  it('keeps queues, limits and translations apart', async () => {
    const { get, send, es } = await twoLanguages();
    await send('PATCH', '/api/languages/es', { dailyNewLimit: 1 });

    const polish = await get<ReviewQueueDto>('/api/review/queue?tzOffset=0');
    expect(lemmas(polish.cards)).toEqual(['dom', 'kot']);
    expect(polish.cards[0]).toMatchObject({ lang: 'pl', nativeLang: 'en' });
    expect(polish.limits.newPerDay).toBe(20);

    const spanish = await get<ReviewQueueDto>('/api/review/queue?tzOffset=0&lang=es');
    expect(spanish.cards).toHaveLength(1);
    expect(spanish.cards[0]).toMatchObject({ lang: 'es', nativeLang: 'pt' });
    expect(spanish.cards[0]?.translations).toEqual([`${spanish.cards[0]?.lemma}-tr`]);
    expect(spanish.limits.newPerDay).toBe(1);
    // A theme's queue uses its language's limits.
    const themeQueue = await get<ReviewQueueDto>(`/api/review/queue?tzOffset=0&themeId=${es.id}`);
    expect(themeQueue.limits.newPerDay).toBe(1);

    // Learning a Spanish word uses up Spanish's new-word budget, not Polish's.
    const card = spanish.cards[0];
    expect(
      (await send('POST', `/api/review/cards/${card?.cardId}`, { rating: 'good' })).status,
    ).toBe(200);
    expect((await get<ReviewQueueDto>('/api/review/queue?tzOffset=0&lang=es')).newCount).toBe(0);
    const after = await get<ReviewQueueDto>('/api/review/queue?tzOffset=0');
    expect([after.newCount, after.newToday]).toEqual([2, 0]);

    expect((await send('GET', '/api/review/queue?tzOffset=0&lang=fr')).status).toBe(404);
  });

  it('scopes the summary, lessons and stats', async () => {
    const { get } = await twoLanguages();
    const summary = await get<ReviewSummaryDto>('/api/review/summary?tzOffset=0&lang=es');
    expect(summary.themes.map((t) => t.name)).toEqual(['Casa']);
    expect(summary.newAvailable).toBe(3);
    expect((await get<ReviewSummaryDto>('/api/review/summary?tzOffset=0')).themes).toHaveLength(1);

    const lesson = await get<LessonDto>('/api/lessons?tzOffset=0&lang=es');
    expect(lemmas(lesson.items.map((i) => i.card))).toEqual(['casa', 'gato', 'perro']);

    const stats = await get<StatsDto>('/api/stats?tzOffset=0&lang=es');
    expect(stats.words.map((x) => x.lemma).sort()).toEqual(['casa', 'gato', 'perro']);
    expect(stats.words[0]?.translations).toEqual([`${stats.words[0]?.lemma}-tr`]);
    expect((await get<StatsDto>('/api/stats?tzOffset=0')).totals.words).toBe(2);
  });

  it('stores edited translations in the word’s own translation language', async () => {
    const { send, db, lexemeId } = await twoLanguages();
    const gato = lexemeId('gato');
    expect((await send('PATCH', `/api/words/${gato}`, { translations: ['gato'] })).status).toBe(
      200,
    );
    expect(
      db
        .select({ lang: schema.lexemeTranslations.lang, text: schema.lexemeTranslations.text })
        .from(schema.lexemeTranslations)
        .where(eq(schema.lexemeTranslations.lexemeId, gato))
        .all(),
    ).toEqual([{ lang: 'pt', text: 'gato' }]);
  });
});
