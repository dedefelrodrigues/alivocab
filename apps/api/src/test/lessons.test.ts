import { CARD_STATE } from '@alivocab/core';
import { schema } from '@alivocab/db';
import type { LessonDto, ThemeSummaryDto, WordStatus } from '@alivocab/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { buildLesson } from '../lib/lessons.ts';
import { createTestApp } from './helpers.ts';

const w = (lemma: string, status: WordStatus = 'unknown', extra: Record<string, unknown> = {}) => ({
  lemma,
  pos: 'noun',
  gender: 'm',
  translations: [`${lemma}-en`],
  status,
  imageQuery: '',
  ...extra,
});

const FRUIT = ['jabłko', 'banan', 'gruszka', 'śliwka', 'wiśnia'];

async function setup(words = FRUIT.map((l) => w(l))) {
  const ctx = createTestApp();
  const cookie = await ctx.createUser('a@test.dev');
  const theme = (await (
    await ctx.call('/api/themes', { method: 'POST', cookie, body: { name: 'Owoce', words } })
  ).json()) as ThemeSummaryDto;
  const user = ctx.db.select().from(schema.user).where(eq(schema.user.email, 'a@test.dev')).get();
  if (!user) throw new Error('no user');
  return { ...ctx, cookie, theme, userId: user.id };
}

/** Puts a word's card into an established review state. */
function establish(
  ctx: Awaited<ReturnType<typeof setup>>,
  lemma: string,
  direction: 'recognition' | 'recall',
) {
  const lexeme = ctx.db.select().from(schema.lexemes).where(eq(schema.lexemes.lemma, lemma)).get();
  ctx.db
    .update(schema.cards)
    .set({
      state: CARD_STATE.review,
      stability: 10,
      difficulty: 5,
      reps: 3,
      lastReview: new Date(Date.now() - 10 * 86_400_000),
      due: new Date(Date.now() - 1000),
    })
    .where(and(eq(schema.cards.lexemeId, lexeme?.id ?? ''), eq(schema.cards.direction, direction)))
    .run();
  return lexeme?.id ?? '';
}

const lesson = (ctx: Awaited<ReturnType<typeof setup>>, rand = () => 0.1, mode = 'due' as const) =>
  buildLesson(
    ctx.db,
    ctx.userId,
    { mode, size: 15, tzOffset: 0, themeId: ctx.theme.id },
    new Date(),
    rand,
  );

describe('lessons', () => {
  it('introduces new words with flashcards', async () => {
    const ctx = await setup();
    const res = await ctx.call(`/api/lessons?themeId=${ctx.theme.id}`, { cookie: ctx.cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as LessonDto;
    expect(body.items).toHaveLength(5);
    expect(body.items.every((i) => i.kind === 'intro')).toBe(true);
    // Meaning options ride along, for when the word comes back later in the lesson.
    expect(body.items[0]?.options).toHaveLength(4);
  });

  it('offers four distinct options including the right one for recognition', async () => {
    const ctx = await setup();
    establish(ctx, 'banan', 'recognition');
    const item = lesson(ctx).items.find((i) => i.card.lemma === 'banan');
    expect(item?.kind).toBe('choose_meaning');
    const texts = item?.options?.map((o) => o.text) ?? [];
    expect(texts).toHaveLength(4);
    expect(new Set(texts).size).toBe(4);
    expect(item?.options?.filter((o) => o.lexemeId === item.card.lexemeId)).toEqual([
      expect.objectContaining({ text: 'banan-en' }),
    ]);
  });

  it('asks for the word while recall is learned, then to type it or fill in a sentence', async () => {
    const ctx = await setup([
      ...FRUIT.slice(1).map((l) => w(l)),
      w('jabłko', 'unknown', {
        examples: [{ text: 'Jem jabłko.', translation: 'I eat an apple.', cloze: 'jabłko' }],
      }),
    ]);
    const lexemeId = establish(ctx, 'jabłko', 'recognition');
    // Recall is still new: pick the word.
    let item = lesson(ctx).items.find(
      (i) => i.card.lexemeId === lexemeId && i.card.direction === 'recall',
    );
    expect(item?.kind).toBe('choose_word');
    expect(item?.options?.map((o) => o.text)).toContain('jabłko');

    establish(ctx, 'jabłko', 'recall');
    item = lesson(ctx, () => 0.1).items.find((i) => i.card.direction === 'recall');
    expect(item?.kind).toBe('cloze');
    expect(item?.cloze).toEqual({
      before: 'Jem ',
      answer: 'jabłko',
      after: '.',
      translation: 'I eat an apple.',
    });
    item = lesson(ctx, () => 0.9).items.find((i) => i.card.direction === 'recall');
    expect(item?.kind).toBe('type_word');
  });

  it('offers picture options when enough words have pictures', async () => {
    const ctx = await setup();
    for (const lexeme of ctx.db.select().from(schema.lexemes).all()) {
      const image = ctx.db
        .insert(schema.lexemeImages)
        .values({
          lexemeId: lexeme.id,
          provider: 'wikimedia',
          providerId: lexeme.id,
          fileKey: lexeme.id.padEnd(32, '0').slice(0, 32),
          width: 480,
          height: 360,
        })
        .returning()
        .get();
      ctx.db
        .update(schema.lexemes)
        .set({ imageId: image.id })
        .where(eq(schema.lexemes.id, lexeme.id))
        .run();
    }
    establish(ctx, 'gruszka', 'recognition');
    const item = lesson(ctx, () => 0.1).items.find((i) => i.card.lemma === 'gruszka');
    expect(item?.kind).toBe('choose_picture');
    expect(item?.options).toHaveLength(4);
    // Picture options carry no text that would give the answer away.
    expect(item?.options?.every((o) => o.text === '' && o.image)).toBe(true);
  });

  it('falls back to a flashcard when there are too few words for options', async () => {
    const ctx = await setup([w('kot'), w('pies')]);
    establish(ctx, 'kot', 'recognition');
    expect(lesson(ctx).items.find((i) => i.card.lemma === 'kot')?.kind).toBe('intro');
  });

  it('grades typed answers through the review endpoint and logs the answer', async () => {
    const ctx = await setup();
    establish(ctx, 'banan', 'recall');
    const item = lesson(ctx, () => 0.9).items.find((i) => i.card.lemma === 'banan');
    expect(item?.kind).toBe('type_word');
    const res = await ctx.call(`/api/review/cards/${item?.card.cardId}`, {
      method: 'POST',
      cookie: ctx.cookie,
      body: { rating: 'hard', exerciseType: 'typing', answer: 'banan ', responseMs: 4200 },
    });
    expect(res.status).toBe(200);
    expect(ctx.db.select().from(schema.reviewLogs).get()).toMatchObject({
      exerciseType: 'typing',
      answerGiven: 'banan ',
      rating: 2,
    });
  });

  it('offers extra practice on the weakest words without touching the schedule', async () => {
    const ctx = await setup();
    const weak = establish(ctx, 'śliwka', 'recognition');
    establish(ctx, 'banan', 'recognition');
    ctx.db.update(schema.cards).set({ stability: 1 }).where(eq(schema.cards.lexemeId, weak)).run();
    ctx.db
      .update(schema.cards)
      .set({ due: new Date(Date.now() + 86_400_000) })
      .run();

    const res = await ctx.call(`/api/lessons?themeId=${ctx.theme.id}&mode=practice`, {
      cookie: ctx.cookie,
    });
    const body = (await res.json()) as LessonDto;
    expect(body.mode).toBe('practice');
    expect(body.items.map((i) => i.card.lemma).sort()).toEqual(['banan', 'śliwka']);

    const before = ctx.db.select().from(schema.cards).all();
    const done = await ctx.call('/api/lessons/practice', {
      method: 'POST',
      cookie: ctx.cookie,
      body: { lexemeId: weak, exerciseType: 'mcq', correct: false },
    });
    expect(done.status).toBe(200);
    expect(ctx.db.select().from(schema.cards).all()).toEqual(before);
    expect(ctx.db.select().from(schema.reviewLogs).all()).toEqual([]);
    expect(
      ctx.db.select().from(schema.userLexemes).where(eq(schema.userLexemes.lexemeId, weak)).get(),
    ).toMatchObject({ exposureCount: 2, incorrectCount: 1 }); // 1 from seeing it in the proposal
  });

  it('keeps other learners out', async () => {
    const ctx = await setup();
    const bob = await ctx.createUser('bob@test.dev');
    expect((await ctx.call(`/api/lessons?themeId=${ctx.theme.id}`, { cookie: bob })).status).toBe(
      404,
    );
    const lexemeId = ctx.db.select().from(schema.lexemes).get()?.id;
    const res = await ctx.call('/api/lessons/practice', {
      method: 'POST',
      cookie: bob,
      body: { lexemeId, exerciseType: 'mcq', correct: true },
    });
    expect(res.status).toBe(404);
  });
});
