import { schema } from '@alivocab/db';
import type { StatsDto, ThemeSummaryDto } from '@alivocab/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { buildQueue, gradeCard } from '../lib/srs.ts';
import { buildStats } from '../lib/stats.ts';
import { createTestApp } from './helpers.ts';

const w = (lemma: string, status = 'unknown') => ({
  lemma,
  pos: 'noun',
  translations: [`${lemma}-en`],
  status,
  imageQuery: '',
});

async function setup() {
  const ctx = createTestApp();
  const cookie = await ctx.createUser('a@test.dev');
  const make = async (name: string, words: ReturnType<typeof w>[]) =>
    (await (
      await ctx.call('/api/themes', { method: 'POST', cookie, body: { name, words } })
    ).json()) as ThemeSummaryDto;
  const fruit = await make('Owoce', [w('jabłko'), w('banan'), w('gruszka', 'known')]);
  const other = await make('Dom', [w('stół')]);
  const user = ctx.db.select().from(schema.user).where(eq(schema.user.email, 'a@test.dev')).get();
  return { ...ctx, cookie, fruit, other, userId: user?.id ?? '' };
}

describe('stats', () => {
  it('counts reviews per day, status, totals and per-word numbers', async () => {
    const ctx = await setup();
    const now = new Date('2026-10-09T10:00:00Z');
    const yesterday = new Date(now.getTime() - 86_400_000);
    const queue = buildQueue(
      ctx.db,
      ctx.userId,
      { tzOffset: 0, limit: 50, themeId: ctx.fruit.id },
      yesterday,
    );
    const [a, b] = queue.cards;
    gradeCard(
      ctx.db,
      ctx.userId,
      a?.cardId ?? '',
      { rating: 'good', exerciseType: 'mcq', responseMs: 2000 },
      yesterday,
    );
    gradeCard(
      ctx.db,
      ctx.userId,
      b?.cardId ?? '',
      { rating: 'again', exerciseType: 'typing', responseMs: 8000 },
      now,
    );

    const stats = buildStats(
      ctx.db,
      ctx.userId,
      { tzOffset: 0, days: 7, themeId: ctx.fruit.id },
      now,
    );
    expect(stats.daily).toHaveLength(7);
    expect(stats.daily.at(-1)).toEqual({ date: '2026-10-09', reviews: 1, correct: 0, newWords: 1 });
    expect(stats.daily.at(-2)).toMatchObject({ date: '2026-10-08', reviews: 1, correct: 1 });
    expect(stats.timeMs).toBe(10_000);
    expect(stats.streakDays).toBe(2);
    // Only new cards were reviewed, so there's nothing to measure retention on yet.
    expect(stats.retention.all).toEqual({ correct: 0, total: 0 });
    expect(stats.status).toMatchObject({ unknown: 2, known: 1 });
    expect(stats.totals).toMatchObject({ words: 3, reviews: 2 });
    const banan = stats.words.find((x) => x.lexemeId === b?.lexemeId);
    expect(banan).toMatchObject({ reviews: 1, incorrect: 1, translations: [`${b?.lemma}-en`] });
    // The other theme is left out.
    expect(stats.words.some((x) => x.lemma === 'stół')).toBe(false);
  });

  it('measures retention on cards that were already learned', async () => {
    const ctx = await setup();
    const card = ctx.db
      .select()
      .from(schema.cards)
      .where(eq(schema.cards.direction, 'recognition'))
      .get();
    ctx.db
      .update(schema.cards)
      .set({
        state: 2,
        stability: 30,
        difficulty: 5,
        reps: 4,
        lastReview: new Date(Date.now() - 30 * 86_400_000),
        due: new Date(),
      })
      .where(eq(schema.cards.id, card?.id ?? ''))
      .run();
    gradeCard(ctx.db, ctx.userId, card?.id ?? '', { rating: 'good', exerciseType: 'flashcard' });
    const res = await ctx.call('/api/stats?tzOffset=0', { cookie: ctx.cookie });
    expect(res.status).toBe(200);
    const stats = (await res.json()) as StatsDto;
    expect(stats.retention).toEqual({
      all: { correct: 1, total: 1 },
      young: { correct: 0, total: 0 },
      mature: { correct: 1, total: 1 },
    });
    expect(stats.daily).toHaveLength(30);
  });

  it('keeps other learners out', async () => {
    const ctx = await setup();
    const bob = await ctx.createUser('bob@test.dev');
    expect((await ctx.call(`/api/stats?themeId=${ctx.fruit.id}`, { cookie: bob })).status).toBe(
      404,
    );
    const own = (await (await ctx.call('/api/stats', { cookie: bob })).json()) as StatsDto;
    expect(own.totals.words).toBe(0);
  });
});
