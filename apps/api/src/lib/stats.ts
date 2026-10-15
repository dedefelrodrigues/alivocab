/** Progress statistics over review logs, exposures and word states (the Stats page). */
import { CARD_STATE } from '@alivocab/core';
import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import type { RetentionDto, StatsDto, StatusCounts, WordStatsDto } from '@alivocab/shared';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import { requestLanguage } from './languages.ts';
import { resolvePictures } from './pictures/resolve.ts';
import { inLang, localDateKey, startOfLocalDay, streakDays } from './srs.ts';

const { cards, lexemes, lexemeTranslations, reviewLogs, themeLexemes, userLexemes } = schema;

const DAY = 86_400_000;
/** Cards remembered for at least this many days count as mature. */
const MATURE_DAYS = 21;

/**
 * Stats for a theme or one learning language (`lang`, default the active one); the streak counts
 * every language.
 */
export function buildStats(
  db: Db,
  userId: string,
  opts: { themeId?: string; lang?: string; tzOffset: number; days: number },
  now = new Date(),
): StatsDto {
  const language = requestLanguage(db, userId, opts);
  const inTheme = (column: typeof cards.lexemeId | typeof userLexemes.lexemeId) =>
    opts.themeId
      ? inArray(
          column,
          sql`(select ${themeLexemes.lexemeId} from ${themeLexemes} where ${themeLexemes.themeId} = ${opts.themeId})`,
        )
      : undefined;
  const from = new Date(startOfLocalDay(now, opts.tzOffset).getTime() - (opts.days - 1) * DAY);

  // ── Reviews in the period ───────────────────────────────────────────────
  const logs = db
    .select({
      at: reviewLogs.reviewedAt,
      correct: reviewLogs.correct,
      stateBefore: reviewLogs.stateBefore,
      stabilityBefore: reviewLogs.stabilityBefore,
      responseMs: reviewLogs.responseMs,
    })
    .from(reviewLogs)
    .innerJoin(cards, eq(cards.id, reviewLogs.cardId))
    .where(
      and(
        eq(reviewLogs.userId, userId),
        gte(reviewLogs.reviewedAt, from),
        inLang(language.lang),
        inTheme(cards.lexemeId),
      ),
    )
    .all();

  const daily = Array.from({ length: opts.days }, (_, i) => ({
    date: localDateKey(new Date(from.getTime() + i * DAY + DAY / 2), opts.tzOffset),
    reviews: 0,
    correct: 0,
    newWords: 0,
  }));
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const retention = {
    all: { correct: 0, total: 0 } as RetentionDto,
    young: { correct: 0, total: 0 } as RetentionDto,
    mature: { correct: 0, total: 0 } as RetentionDto,
  };
  let timeMs = 0;
  for (const log of logs) {
    const day = byDate.get(localDateKey(log.at, opts.tzOffset));
    if (day) {
      day.reviews++;
      if (log.correct) day.correct++;
      if (log.stateBefore === CARD_STATE.new) day.newWords++;
    }
    timeMs += Math.min(log.responseMs ?? 0, 5 * 60_000);
    // Retention is about remembering: first sightings of new cards don't count.
    if (log.stateBefore === CARD_STATE.new) continue;
    const bucket = log.stabilityBefore >= MATURE_DAYS ? retention.mature : retention.young;
    for (const r of [retention.all, bucket]) {
      r.total++;
      if (log.correct) r.correct++;
    }
  }

  // ── Words ───────────────────────────────────────────────────────────────
  const own = db
    .select({ own: userLexemes, lexeme: lexemes })
    .from(userLexemes)
    .innerJoin(lexemes, eq(lexemes.id, userLexemes.lexemeId))
    .where(
      and(
        eq(userLexemes.userId, userId),
        eq(lexemes.lang, language.lang),
        inTheme(userLexemes.lexemeId),
      ),
    )
    .all();
  const ids = own.map((r) => r.lexeme.id);
  const { nativeLang } = language;

  const translations = new Map<string, string[]>();
  const reviewCounts = new Map<string, number>();
  const cardInfo = new Map<string, { lapses: number; nextDue: Date | null }>();
  if (ids.length) {
    for (const t of db
      .select()
      .from(lexemeTranslations)
      .where(
        and(inArray(lexemeTranslations.lexemeId, ids), eq(lexemeTranslations.lang, nativeLang)),
      )
      .orderBy(asc(lexemeTranslations.sort))
      .all()) {
      const list = translations.get(t.lexemeId) ?? [];
      if (list.length < 2) list.push(t.text);
      translations.set(t.lexemeId, list);
    }
    for (const r of db
      .select({ lexemeId: cards.lexemeId, n: sql<number>`count(*)` })
      .from(reviewLogs)
      .innerJoin(cards, eq(cards.id, reviewLogs.cardId))
      .where(and(eq(reviewLogs.userId, userId), inArray(cards.lexemeId, ids)))
      .groupBy(cards.lexemeId)
      .all()) {
      reviewCounts.set(r.lexemeId, r.n);
    }
    for (const c of db
      .select({
        lexemeId: cards.lexemeId,
        lapses: cards.lapses,
        due: cards.due,
        state: cards.state,
      })
      .from(cards)
      .where(and(eq(cards.userId, userId), inArray(cards.lexemeId, ids)))
      .all()) {
      const info = cardInfo.get(c.lexemeId) ?? { lapses: 0, nextDue: null };
      info.lapses += c.lapses;
      if (c.state !== CARD_STATE.new && (!info.nextDue || c.due < info.nextDue))
        info.nextDue = c.due;
      cardInfo.set(c.lexemeId, info);
    }
  }
  const pictures = resolvePictures(db, userId, ids);

  const status: StatusCounts = { untagged: 0, unknown: 0, recognize: 0, known: 0 };
  let exposures = 0;
  const words: WordStatsDto[] = own.map(({ own: o, lexeme }) => {
    status[o.status]++;
    exposures += o.exposureCount;
    const info = cardInfo.get(lexeme.id);
    return {
      lexemeId: lexeme.id,
      lemma: lexeme.lemma,
      lang: lexeme.lang,
      pos: lexeme.pos,
      translations: translations.get(lexeme.id) ?? [],
      status: o.status,
      image: pictures.get(lexeme.id)?.image ?? null,
      exposures: o.exposureCount,
      reviews: reviewCounts.get(lexeme.id) ?? 0,
      correct: o.correctCount,
      incorrect: o.incorrectCount,
      lapses: info?.lapses ?? 0,
      nextDue: info?.nextDue?.toISOString() ?? null,
    };
  });

  return {
    daily,
    retention,
    streakDays: streakDays(db, userId, opts.tzOffset, now),
    timeMs,
    status,
    totals: {
      words: words.length,
      reviews: [...reviewCounts.values()].reduce((a, b) => a + b, 0),
      exposures,
    },
    words,
  };
}
