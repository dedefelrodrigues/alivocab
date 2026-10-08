import { CARD_STATE } from '@alivocab/core';
import { schema } from '@alivocab/db';
import type {
  ReviewQueueDto,
  ReviewSummaryDto,
  ThemeSummaryDto,
  WordStatus,
} from '@alivocab/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { buildQueue, gradeCard, reviewSummary, startOfLocalDay } from '../lib/srs.ts';
import { createTestApp } from './helpers.ts';

const w = (lemma: string, status: WordStatus = 'unknown') => ({
  lemma,
  pos: 'noun',
  translations: [`${lemma}-en`],
  status,
});

async function json<T>(res: Response | Promise<Response>): Promise<T> {
  return (await (await res).json()) as T;
}

async function setup(words: ReturnType<typeof w>[], profile: Record<string, unknown> = {}) {
  const ctx = createTestApp();
  const cookie = await ctx.createUser('a@test.dev');
  if (Object.keys(profile).length) {
    await ctx.call('/api/me/profile', { method: 'PATCH', cookie, body: profile });
  }
  const theme = await json<ThemeSummaryDto>(
    ctx.call('/api/themes', { method: 'POST', cookie, body: { name: 'T', words } }),
  );
  const user = ctx.db.select().from(schema.user).where(eq(schema.user.email, 'a@test.dev')).get();
  if (!user) throw new Error('no user');
  return { ...ctx, cookie, theme, userId: user.id };
}

describe('cards from tags', () => {
  it('creates two cards per word, seeded from the tag', async () => {
    const { db } = await setup([w('a', 'unknown'), w('b', 'recognize'), w('c', 'known')]);
    const rows = db
      .select({
        lemma: schema.lexemes.lemma,
        direction: schema.cards.direction,
        state: schema.cards.state,
      })
      .from(schema.cards)
      .innerJoin(schema.lexemes, eq(schema.lexemes.id, schema.cards.lexemeId))
      .all();
    const state = (lemma: string, direction: string) =>
      rows.find((r) => r.lemma === lemma && r.direction === direction)?.state;
    expect(rows).toHaveLength(6);
    expect([state('a', 'recognition'), state('a', 'recall')]).toEqual([
      CARD_STATE.new,
      CARD_STATE.new,
    ]);
    expect([state('b', 'recognition'), state('b', 'recall')]).toEqual([
      CARD_STATE.review,
      CARD_STATE.new,
    ]);
    expect([state('c', 'recognition'), state('c', 'recall')]).toEqual([
      CARD_STATE.review,
      CARD_STATE.review,
    ]);
  });

  it('reseeds both cards when the tag is changed manually', async () => {
    const { db, call, cookie } = await setup([w('a', 'unknown')]);
    const lexemeId = db.select().from(schema.lexemes).get()?.id;
    await call(`/api/words/${lexemeId}/status`, {
      method: 'PATCH',
      cookie,
      body: { status: 'known' },
    });
    const states = db
      .select({ state: schema.cards.state })
      .from(schema.cards)
      .all()
      .map((c) => c.state);
    expect(states).toEqual([CARD_STATE.review, CARD_STATE.review]);
  });

  it('backfills cards for words saved without them', async () => {
    const { db, userId } = await setup([w('a')]);
    db.delete(schema.cards).run();
    const queue = buildQueue(db, userId, { tzOffset: 0, limit: 50 });
    expect(db.select().from(schema.cards).all()).toHaveLength(2);
    expect(queue.cards.map((c) => c.lemma)).toEqual(['a']);
  });
});

describe('queue', () => {
  it('introduces recognition first and recall only after recognition was seen', async () => {
    const { db, userId } = await setup([w('kot')]);
    const now = new Date();
    let queue = buildQueue(db, userId, { tzOffset: 0, limit: 50 }, now);
    expect(queue.cards.map((c) => c.direction)).toEqual(['recognition']);
    expect(queue.cards[0]).toMatchObject({ lemma: 'kot', translations: ['kot-en'], isNew: true });

    gradeCard(
      db,
      userId,
      queue.cards[0]?.cardId ?? '',
      { rating: 'good', exerciseType: 'flashcard' },
      now,
    );
    queue = buildQueue(db, userId, { tzOffset: 0, limit: 50 }, now);
    expect(queue.cards.map((c) => c.direction)).toEqual(['recall']);
  });

  it('respects the daily new-card limit', async () => {
    const { db, userId } = await setup([w('a'), w('b'), w('c'), w('d'), w('e')], {
      dailyNewLimit: 2,
    });
    const now = new Date();
    const queue = buildQueue(db, userId, { tzOffset: 0, limit: 50 }, now);
    expect(queue.cards).toHaveLength(2);
    expect(queue.newCount).toBe(2);
    for (const card of queue.cards) {
      gradeCard(db, userId, card.cardId, { rating: 'easy', exerciseType: 'flashcard' }, now);
    }
    const after = buildQueue(db, userId, { tzOffset: 0, limit: 50 }, now);
    expect(after).toMatchObject({ newCount: 0, newToday: 2, reviewedToday: 2 });
    expect(after.cards).toHaveLength(0);
  });

  it('skips known words until they are due', async () => {
    const { db, userId } = await setup([w('a', 'known')]);
    const now = new Date();
    expect(buildQueue(db, userId, { tzOffset: 0, limit: 50 }, now).cards).toHaveLength(0);
    const later = new Date(now.getTime() + 41 * 86_400_000);
    expect(buildQueue(db, userId, { tzOffset: 0, limit: 50 }, later).cards).toHaveLength(2);
  });

  it('filters by theme', async () => {
    const { db, userId, call, cookie } = await setup([w('a')]);
    const other = await json<ThemeSummaryDto>(
      call('/api/themes', { method: 'POST', cookie, body: { name: 'Other', words: [w('b')] } }),
    );
    const queue = buildQueue(db, userId, { tzOffset: 0, limit: 50, themeId: other.id });
    expect(queue.cards.map((c) => c.lemma)).toEqual(['b']);
  });
});

describe('grading', () => {
  it('logs the review, counts exposure and requeues failed cards in the session', async () => {
    const { db, call, cookie } = await setup([w('a')]);
    const queue = await json<ReviewQueueDto>(call('/api/review/queue?tzOffset=0', { cookie }));
    const card = queue.cards[0];
    const res = await call(`/api/review/cards/${card?.cardId}`, {
      method: 'POST',
      cookie,
      body: { rating: 'again', responseMs: 2500 },
    });
    expect(res.status).toBe(200);
    const result = (await res.json()) as { requeue: { cardId: string } | null; status: string };
    expect(result.requeue?.cardId).toBe(card?.cardId);
    expect(result.status).toBe('unknown');

    expect(db.select().from(schema.reviewLogs).get()).toMatchObject({
      rating: 1,
      correct: false,
      responseMs: 2500,
      exerciseType: 'flashcard',
      stateBefore: CARD_STATE.new,
    });
    expect(db.select().from(schema.userLexemes).get()).toMatchObject({
      exposureCount: 2,
      incorrectCount: 1,
    });
  });

  it('raises the status as the word is learned over time', async () => {
    const { db, userId } = await setup([w('a', 'unknown')]);
    let now = new Date('2026-01-01T09:00:00Z');
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      const [card] = buildQueue(db, userId, { tzOffset: 0, limit: 50 }, now).cards;
      if (card) {
        const r = gradeCard(
          db,
          userId,
          card.cardId,
          { rating: 'good', exerciseType: 'flashcard' },
          now,
        );
        if (seen.at(-1) !== r.status) seen.push(r.status);
      } else {
        // Jump to the next due card.
        const next = db
          .select({ due: schema.cards.due })
          .from(schema.cards)
          .where(and(eq(schema.cards.userId, userId)))
          .all()
          .map((c) => c.due.getTime())
          .sort((x, y) => x - y)
          .find((t) => t > now.getTime());
        if (!next) break;
        now = new Date(next);
      }
    }
    expect(seen).toEqual(['unknown', 'recognize', 'known']);
  });

  it('never lets one user grade another user’s card', async () => {
    const { db, userId, createUser, call } = await setup([w('a')]);
    const [card] = buildQueue(db, userId, { tzOffset: 0, limit: 50 }).cards;
    const bob = await createUser('bob@test.dev');
    const res = await call(`/api/review/cards/${card?.cardId}`, {
      method: 'POST',
      cookie: bob,
      body: { rating: 'good' },
    });
    expect(res.status).toBe(404);
    const theme = db.select().from(schema.themes).get();
    expect((await call(`/api/review/queue?themeId=${theme?.id}`, { cookie: bob })).status).toBe(
      404,
    );
  });
});

describe('summary', () => {
  it('reports due, new, forecast, streak and per-theme counts', async () => {
    const { db, userId, call, cookie } = await setup([w('a'), w('b', 'recognize')]);
    const now = new Date();
    const [card] = buildQueue(db, userId, { tzOffset: 0, limit: 50 }, now).cards;
    gradeCard(db, userId, card?.cardId ?? '', { rating: 'good', exerciseType: 'flashcard' }, now);

    const summary = reviewSummary(db, userId, 0, now);
    expect(summary.reviewedToday).toBe(1);
    expect(summary.streakDays).toBe(1);
    expect(summary.forecast).toHaveLength(7);
    expect(summary.forecast.reduce((n, d) => n + d.count, 0)).toBeGreaterThanOrEqual(1);
    expect(summary.themes[0]).toMatchObject({ name: 'T' });

    const viaHttp = await json<ReviewSummaryDto>(
      call('/api/review/summary?tzOffset=-120', { cookie }),
    );
    expect(viaHttp.reviewedToday).toBe(1);
  });

  it('computes the local day start from the client offset', () => {
    const now = new Date('2026-10-08T23:30:00Z');
    // UTC+2 (offset -120): local time is 01:30 on the 9th.
    expect(startOfLocalDay(now, -120).toISOString()).toBe('2026-10-08T22:00:00.000Z');
    // UTC-5 (offset 300): local time is 18:30 on the 8th.
    expect(startOfLocalDay(now, 300).toISOString()).toBe('2026-10-08T05:00:00.000Z');
  });
});
