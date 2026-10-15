/**
 * Spaced repetition on top of `cards` / `review_logs`: card creation from tags, the daily
 * queue, grading and the dashboard summary. Scheduling math lives in @alivocab/core.
 */
import {
  CARD_STATE,
  type CardState,
  formatInterval,
  nextStatus,
  previewCard,
  type ReviewRating,
  reviewCard,
  seedCards,
} from '@alivocab/core';
import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import {
  CARD_DIRECTIONS,
  type CardDirection,
  type ExerciseType,
  type GradeResultDto,
  REQUEUE_WINDOW_MS,
  type ReviewCardDto,
  type ReviewQueueDto,
  type ReviewSummaryDto,
  type WordStatus,
} from '@alivocab/shared';
import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { type LanguageRow, nativeLangs, requestLanguage } from './languages.ts';
import { resolvePictures } from './pictures/resolve.ts';

const {
  cards,
  userLexemes,
  lexemes,
  lexemeTranslations,
  exampleSentences,
  reviewLogs,
  exposures,
  themes,
  themeLexemes,
} = schema;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbLike = Db | Tx;
type CardRow = typeof cards.$inferSelect;

const DAY = 86_400_000;

// ── Conversions ─────────────────────────────────────────────────────────────

function toState(row: CardRow): CardState {
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    learningSteps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    lastReview: row.lastReview,
  };
}

/** Local midnight (as a UTC instant) for a client `getTimezoneOffset()` value. */
export function startOfLocalDay(now: Date, tzOffsetMinutes: number): Date {
  const offsetMs = tzOffsetMinutes * 60_000;
  const local = now.getTime() - offsetMs;
  return new Date(Math.floor(local / DAY) * DAY + offsetMs);
}

export function localDateKey(d: Date, tzOffsetMinutes: number): string {
  return new Date(d.getTime() - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

// ── Card creation ───────────────────────────────────────────────────────────

/** Creates both cards for a word from its tag (no-op for cards that already exist). */
export function createCards(
  db: DbLike,
  userId: string,
  lexemeId: string,
  status: WordStatus,
  now: Date,
): void {
  const seeded = seedCards(status, now);
  for (const direction of CARD_DIRECTIONS) {
    db.insert(cards)
      .values({ userId, lexemeId, direction, ...seeded[direction] })
      .onConflictDoNothing()
      .run();
  }
}

/** A manual re-tag resets both cards to the tag's starting point (review history is kept). */
export function reseedCards(
  db: DbLike,
  userId: string,
  lexemeId: string,
  status: WordStatus,
  now: Date,
): void {
  const seeded = seedCards(status, now);
  for (const direction of CARD_DIRECTIONS) {
    const updated = db
      .update(cards)
      .set(seeded[direction])
      .where(
        and(eq(cards.userId, userId), eq(cards.lexemeId, lexemeId), eq(cards.direction, direction)),
      )
      .run();
    if (!updated.changes) {
      db.insert(cards)
        .values({ userId, lexemeId, direction, ...seeded[direction] })
        .run();
    }
  }
}

/** Creates missing cards for words saved before SRS existed (or added any other way). */
export function backfillCards(db: Db, userId: string, now: Date): number {
  const missing = db
    .select({ lexemeId: userLexemes.lexemeId, status: userLexemes.status })
    .from(userLexemes)
    .leftJoin(
      cards,
      and(eq(cards.userId, userLexemes.userId), eq(cards.lexemeId, userLexemes.lexemeId)),
    )
    .where(and(eq(userLexemes.userId, userId), isNull(cards.id)))
    .all();
  if (missing.length) {
    db.transaction((tx) => {
      for (const m of missing) createCards(tx, userId, m.lexemeId, m.status, now);
    });
  }
  return missing.length;
}

// ── Queue ───────────────────────────────────────────────────────────────────

type DayStats = { reviewedToday: number; newToday: number; dayStart: Date };

/** Today's reviews in one language (each learning language has its own daily limits). */
function dayStats(db: Db, userId: string, lang: string, now: Date, tzOffset: number): DayStats {
  const dayStart = startOfLocalDay(now, tzOffset);
  const row = db
    .select({
      reviewed: sql<number>`count(*)`,
      introduced: sql<number>`count(distinct case when ${reviewLogs.stateBefore} = ${CARD_STATE.new} then ${reviewLogs.cardId} end)`,
    })
    .from(reviewLogs)
    .innerJoin(cards, eq(cards.id, reviewLogs.cardId))
    .where(and(eq(reviewLogs.userId, userId), gte(reviewLogs.reviewedAt, dayStart), inLang(lang)))
    .get();
  return { reviewedToday: row?.reviewed ?? 0, newToday: row?.introduced ?? 0, dayStart };
}

/** Which cards a queue covers: one learning language, optionally one theme. */
type Scope = { lang: string; themeId?: string };

/** Restricts a card query to the words of one language. */
export function inLang(lang: string) {
  return inArray(
    cards.lexemeId,
    sql`(select ${lexemes.id} from ${lexemes} where ${lexemes.lang} = ${lang})`,
  );
}

function inScope({ lang, themeId }: Scope) {
  return and(inLang(lang), inTheme(themeId));
}

/** Restricts a card query to one theme, when given. */
function inTheme(themeId: string | undefined) {
  return themeId
    ? inArray(
        cards.lexemeId,
        sql`(select ${themeLexemes.lexemeId} from ${themeLexemes} where ${themeLexemes.themeId} = ${themeId})`,
      )
    : undefined;
}

/** New cards in introduction order: recognition first; recall once recognition was seen. */
function newCardIds(db: Db, userId: string, scope: Scope, limit: number): string[] {
  if (limit <= 0) return [];
  const recognitionSeen = sql`exists (select 1 from ${cards} r where r.user_id = ${cards.userId} and r.lexeme_id = ${cards.lexemeId} and r.direction = 'recognition' and r.state != ${CARD_STATE.new})`;
  return (
    db
      .select({ id: cards.id })
      .from(cards)
      .innerJoin(
        userLexemes,
        and(eq(userLexemes.userId, cards.userId), eq(userLexemes.lexemeId, cards.lexemeId)),
      )
      .where(
        and(
          eq(cards.userId, userId),
          eq(cards.state, CARD_STATE.new),
          eq(cards.suspended, false),
          inScope(scope),
          sql`(${cards.direction} = 'recognition' or ${recognitionSeen})`,
        ),
      )
      // Words seen longer ago first; recall cards before brand-new words so pairs complete.
      .orderBy(
        sql`case when ${cards.direction} = 'recall' then 0 else 1 end`,
        asc(userLexemes.firstSeenAt),
        asc(cards.id),
      )
      .limit(limit)
      .all()
      .map((r) => r.id)
  );
}

function dueCardIds(db: Db, userId: string, scope: Scope, now: Date, limit: number): string[] {
  if (limit <= 0) return [];
  return db
    .select({ id: cards.id })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        ne(cards.state, CARD_STATE.new),
        eq(cards.suspended, false),
        lte(cards.due, now),
        inScope(scope),
      ),
    )
    .orderBy(asc(cards.due))
    .limit(limit)
    .all()
    .map((r) => r.id);
}

function countDue(db: Db, userId: string, scope: Scope, until: Date): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(cards)
      .where(
        and(
          eq(cards.userId, userId),
          ne(cards.state, CARD_STATE.new),
          eq(cards.suspended, false),
          lte(cards.due, until),
          inScope(scope),
        ),
      )
      .get()?.n ?? 0
  );
}

/** Loads cards with everything the flashcard needs, preserving the given order. */
export function hydrateCards(
  db: Db,
  userId: string,
  cardIds: string[],
  now: Date,
): ReviewCardDto[] {
  if (!cardIds.length) return [];
  const nativeOf = nativeLangs(db, userId);
  const rows = db
    .select({ card: cards, lexeme: lexemes, own: userLexemes })
    .from(cards)
    .innerJoin(lexemes, eq(lexemes.id, cards.lexemeId))
    .innerJoin(
      userLexemes,
      and(eq(userLexemes.userId, cards.userId), eq(userLexemes.lexemeId, cards.lexemeId)),
    )
    .where(and(eq(cards.userId, userId), inArray(cards.id, cardIds)))
    .all();
  const lexemeIds = [...new Set(rows.map((r) => r.lexeme.id))];
  // Words are shown with translations in their own language's translation language.
  const nativeOfWord = new Map(rows.map((r) => [r.lexeme.id, nativeOf(r.lexeme.lang)]));

  const translations = new Map<string, string[]>();
  for (const t of db
    .select()
    .from(lexemeTranslations)
    .where(inArray(lexemeTranslations.lexemeId, lexemeIds))
    .orderBy(asc(lexemeTranslations.sort))
    .all()) {
    if (t.lang !== nativeOfWord.get(t.lexemeId)) continue;
    translations.set(t.lexemeId, [...(translations.get(t.lexemeId) ?? []), t.text]);
  }
  const examples = new Map<string, ReviewCardDto['examples']>();
  for (const e of db
    .select()
    .from(exampleSentences)
    .where(inArray(exampleSentences.lexemeId, lexemeIds))
    .orderBy(asc(exampleSentences.createdAt))
    .all()) {
    if (e.translationLang && e.translationLang !== nativeOfWord.get(e.lexemeId)) continue;
    const list = examples.get(e.lexemeId) ?? [];
    if (list.length < 2)
      list.push({ text: e.text, translation: e.translation, cloze: e.clozeTarget });
    examples.set(e.lexemeId, list);
  }

  const pictures = resolvePictures(db, userId, lexemeIds);

  const byId = new Map(
    rows.map(({ card, lexeme, own }) => {
      const preview = previewCard(toState(card), now);
      const dto: ReviewCardDto = {
        cardId: card.id,
        lexemeId: lexeme.id,
        direction: card.direction,
        isNew: card.state === CARD_STATE.new,
        lang: lexeme.lang,
        nativeLang: nativeOf(lexeme.lang),
        lemma: lexeme.lemma,
        pos: lexeme.pos,
        gender: lexeme.gender,
        aspect: lexeme.aspect,
        aspectPair: lexeme.aspectPairLemma,
        forms: lexeme.forms ?? null,
        pronunciation: lexeme.pronunciation,
        translations: translations.get(lexeme.id) ?? [],
        examples: examples.get(lexeme.id) ?? [],
        note: own.note,
        mnemonic: own.mnemonic,
        status: own.status,
        image: pictures.get(lexeme.id)?.image ?? null,
        intervals: {
          again: formatInterval(preview.again, now),
          hard: formatInterval(preview.hard, now),
          good: formatInterval(preview.good, now),
          easy: formatInterval(preview.easy, now),
        },
      };
      return [card.id, dto] as const;
    }),
  );
  return cardIds.map((id) => byId.get(id)).filter((c): c is ReviewCardDto => !!c);
}

/** Mixes new cards into the reviews: roughly one new card after every three reviews. */
function interleave(due: string[], fresh: string[]): string[] {
  const out: string[] = [];
  let d = 0;
  let f = 0;
  while (d < due.length || f < fresh.length) {
    for (let i = 0; i < 3 && d < due.length; i++) out.push(due[d++] as string);
    if (f < fresh.length) out.push(fresh[f++] as string);
  }
  return out;
}

/** What is left of a language's daily limits. */
function budgets(language: LanguageRow, stats: DayStats) {
  return {
    review: Math.max(0, language.dailyReviewLimit - (stats.reviewedToday - stats.newToday)),
    new: Math.max(0, language.dailyNewLimit - stats.newToday),
  };
}

/**
 * Today's cards for a theme (in its language) or for one learning language (`lang`, default the
 * active one), within that language's daily limits.
 */
export function buildQueue(
  db: Db,
  userId: string,
  opts: { themeId?: string; lang?: string; tzOffset: number; limit: number },
  now = new Date(),
): ReviewQueueDto {
  backfillCards(db, userId, now);
  const language = requestLanguage(db, userId, opts);
  const scope: Scope = { lang: language.lang, themeId: opts.themeId };
  const stats = dayStats(db, userId, language.lang, now, opts.tzOffset);
  const budget = budgets(language, stats);

  const due = dueCardIds(db, userId, scope, now, Math.min(budget.review, opts.limit));
  const fresh = newCardIds(db, userId, scope, Math.min(budget.new, opts.limit - due.length));
  const ids = interleave(due, fresh);

  return {
    cards: hydrateCards(db, userId, ids, now),
    dueCount: Math.min(countDue(db, userId, scope, now), budget.review),
    newCount: newCardIds(db, userId, scope, budget.new).length,
    reviewedToday: stats.reviewedToday,
    newToday: stats.newToday,
    limits: { newPerDay: language.dailyNewLimit, reviewsPerDay: language.dailyReviewLimit },
  };
}

// ── Grading ─────────────────────────────────────────────────────────────────

export function gradeCard(
  db: Db,
  userId: string,
  cardId: string,
  input: {
    rating: ReviewRating;
    exerciseType: ExerciseType;
    responseMs?: number;
    answer?: string;
  },
  now = new Date(),
): GradeResultDto {
  const row = db
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
    .get();
  if (!row) throw new HTTPException(404, { message: 'Card not found' });

  const before = toState(row);
  const after = reviewCard(before, input.rating, now);
  const success = input.rating !== 'again';

  const status = db.transaction((tx) => {
    tx.update(cards).set(after).where(eq(cards.id, row.id)).run();
    tx.insert(reviewLogs)
      .values({
        cardId: row.id,
        userId,
        rating: ['again', 'hard', 'good', 'easy'].indexOf(input.rating) + 1,
        exerciseType: input.exerciseType,
        correct: success,
        responseMs: input.responseMs ?? null,
        answerGiven: input.answer ?? null,
        stateBefore: before.state,
        stabilityBefore: before.stability,
        dueBefore: before.due,
        reviewedAt: now,
      })
      .run();
    tx.insert(exposures)
      .values({ userId, lexemeId: row.lexemeId, context: input.exerciseType, at: now })
      .run();

    const siblings = tx
      .select()
      .from(cards)
      .where(and(eq(cards.userId, userId), eq(cards.lexemeId, row.lexemeId)))
      .all();
    const byDirection = Object.fromEntries(
      siblings.map((c) => [c.direction, c.id === row.id ? after : toState(c)]),
    ) as Record<CardDirection, CardState>;
    const own = tx
      .select()
      .from(userLexemes)
      .where(and(eq(userLexemes.userId, userId), eq(userLexemes.lexemeId, row.lexemeId)))
      .get();
    const current = own?.status ?? 'untagged';
    const next =
      byDirection.recognition && byDirection.recall
        ? nextStatus(current, byDirection, success)
        : current;

    tx.update(userLexemes)
      .set({
        exposureCount: sql`${userLexemes.exposureCount} + 1`,
        ...(success
          ? { correctCount: sql`${userLexemes.correctCount} + 1` }
          : { incorrectCount: sql`${userLexemes.incorrectCount} + 1` }),
        lastSeenAt: now,
        ...(next !== current ? { status: next, statusSource: 'derived' as const } : {}),
      })
      .where(and(eq(userLexemes.userId, userId), eq(userLexemes.lexemeId, row.lexemeId)))
      .run();
    return next;
  });

  const soon = after.due.getTime() - now.getTime() <= REQUEUE_WINDOW_MS;
  return {
    cardId: row.id,
    due: after.due.toISOString(),
    status,
    requeue: soon ? (hydrateCards(db, userId, [row.id], after.due)[0] ?? null) : null,
  };
}

// ── Summary ─────────────────────────────────────────────────────────────────

/** Consecutive local days with at least one review, ending today (or yesterday). */
export function streakDays(db: Db, userId: string, tzOffset: number, now = new Date()): number {
  const days = new Set(
    db
      .select({ at: reviewLogs.reviewedAt })
      .from(reviewLogs)
      .where(
        and(
          eq(reviewLogs.userId, userId),
          gte(reviewLogs.reviewedAt, new Date(now.getTime() - 400 * DAY)),
        ),
      )
      .all()
      .map((r) => localDateKey(r.at, tzOffset)),
  );
  let streak = 0;
  let cursor = startOfLocalDay(now, tzOffset).getTime() + DAY / 2;
  if (!days.has(localDateKey(new Date(cursor), tzOffset))) cursor -= DAY;
  while (days.has(localDateKey(new Date(cursor), tzOffset))) {
    streak++;
    cursor -= DAY;
  }
  return streak;
}

/**
 * The dashboard for one learning language (`lang`, default the active one). The streak counts
 * every language.
 */
export function reviewSummary(
  db: Db,
  userId: string,
  opts: { tzOffset: number; lang?: string },
  now = new Date(),
): ReviewSummaryDto {
  const { tzOffset } = opts;
  backfillCards(db, userId, now);
  const language = requestLanguage(db, userId, { lang: opts.lang });
  const scope: Scope = { lang: language.lang };
  const stats = dayStats(db, userId, language.lang, now, tzOffset);
  const budget = budgets(language, stats);

  // Reviews due on each of the next 7 local days (today includes overdue cards).
  const horizon = new Date(stats.dayStart.getTime() + 7 * DAY);
  const upcoming = db
    .select({ due: cards.due })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        ne(cards.state, CARD_STATE.new),
        eq(cards.suspended, false),
        lte(cards.due, horizon),
        inLang(language.lang),
      ),
    )
    .all();
  const forecast = Array.from({ length: 7 }, (_, i) => ({
    date: localDateKey(new Date(stats.dayStart.getTime() + i * DAY + 1), tzOffset),
    count: 0,
  }));
  for (const { due } of upcoming) {
    const index = Math.max(0, Math.floor((due.getTime() - stats.dayStart.getTime()) / DAY));
    const slot = forecast[index];
    if (slot) slot.count++;
  }

  const streak = streakDays(db, userId, tzOffset, now);

  const userThemes = db
    .select({ id: themes.id, name: themes.name })
    .from(themes)
    .where(and(eq(themes.userId, userId), eq(themes.targetLang, language.lang)))
    .orderBy(sql`${themes.updatedAt} desc`)
    .all();

  return {
    dueNow: Math.min(countDue(db, userId, scope, now), budget.review),
    newAvailable: newCardIds(db, userId, scope, budget.new).length,
    reviewedToday: stats.reviewedToday,
    streakDays: streak,
    forecast,
    themes: userThemes.map((t) => ({
      id: t.id,
      name: t.name,
      due: countDue(db, userId, { ...scope, themeId: t.id }, now),
      new: newCardIds(db, userId, { ...scope, themeId: t.id }, 1000).length,
    })),
  };
}
