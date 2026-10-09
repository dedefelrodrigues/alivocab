/**
 * Lessons: a mix of exercises over the review queue (or, for extra practice, the weakest words).
 * Exercises are chosen per card by `chooseExercise` (@alivocab/core); answers are checked in the
 * browser and graded through `gradeCard()` like flashcards.
 */
import {
  buildCloze,
  buildScramble,
  CARD_STATE,
  type ChoiceCandidate,
  type ChoiceMode,
  chooseExercise,
  pickDistractors,
  pickDrill,
  shuffle,
} from '@alivocab/core';
import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import type {
  ExerciseKind,
  ExerciseType,
  LessonDto,
  LessonItemDto,
  LessonMode,
  LessonOptionDto,
  PictureDto,
  ReviewCardDto,
} from '@alivocab/shared';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { resolvePictures } from './pictures/resolve.ts';
import { getOrCreateProfile } from './profile.ts';
import { buildQueue, hydrateCards } from './srs.ts';

const {
  cards,
  exampleSentences,
  lexemes,
  lexemeTranslations,
  themeLexemes,
  themes,
  userLexemes,
  exposures,
} = schema;

/** Options per multiple-choice exercise, including the right one. */
const OPTION_COUNT = 4;

type PoolWord = ChoiceCandidate & { lang: string; image: PictureDto | null };

/** Every word the learner has, as distractor candidates (per target language). */
function loadPool(db: Db, userId: string, nativeLang: string) {
  const rows = db
    .select({
      id: lexemes.id,
      lemma: lexemes.lemma,
      pos: lexemes.pos,
      gender: lexemes.gender,
      lang: lexemes.lang,
    })
    .from(userLexemes)
    .innerJoin(lexemes, eq(lexemes.id, userLexemes.lexemeId))
    .where(eq(userLexemes.userId, userId))
    .all();
  const ids = rows.map((r) => r.id);
  const translations = new Map<string, string[]>();
  if (ids.length) {
    for (const t of db
      .select()
      .from(lexemeTranslations)
      .where(
        and(inArray(lexemeTranslations.lexemeId, ids), eq(lexemeTranslations.lang, nativeLang)),
      )
      .orderBy(asc(lexemeTranslations.sort))
      .all()) {
      translations.set(t.lexemeId, [...(translations.get(t.lexemeId) ?? []), t.text]);
    }
  }
  const pictures = resolvePictures(db, userId, ids);
  const themesOf = new Map<string, Set<string>>();
  for (const r of db
    .select({ lexemeId: themeLexemes.lexemeId, themeId: themeLexemes.themeId })
    .from(themeLexemes)
    .innerJoin(themes, eq(themes.id, themeLexemes.themeId))
    .where(eq(themes.userId, userId))
    .all()) {
    themesOf.set(r.lexemeId, (themesOf.get(r.lexemeId) ?? new Set()).add(r.themeId));
  }
  const words: PoolWord[] = rows.map((r) => {
    const image = pictures.get(r.id)?.image ?? null;
    return {
      ...r,
      translations: translations.get(r.id) ?? [],
      image,
      hasImage: !!image,
      sameTheme: false,
    };
  });
  return { words, themesOf };
}

const meaningText = (translations: string[]) => translations.slice(0, 2).join(', ');

function option(word: PoolWord | ReviewCardDto, mode: ChoiceMode): LessonOptionDto {
  const lexemeId = 'lexemeId' in word ? word.lexemeId : word.id;
  if (mode === 'image') return { lexemeId, text: '', image: word.image };
  return {
    lexemeId,
    text: mode === 'lemma' ? word.lemma : meaningText(word.translations),
    image: null,
  };
}

/** Card state and stability (the DTO doesn't carry FSRS internals). */
function cardStates(db: Db, userId: string, cardIds: string[]) {
  if (!cardIds.length) return new Map<string, { state: number; stability: number }>();
  return new Map(
    db
      .select({ id: cards.id, state: cards.state, stability: cards.stability })
      .from(cards)
      .where(and(eq(cards.userId, userId), inArray(cards.id, cardIds)))
      .all()
      .map((r) => [r.id, r] as const),
  );
}

/**
 * One card per word, the weakest first: for extra practice outside the schedule. For drills,
 * only words with grammatical forms, preferring their recall card (producing the word).
 */
function weakestCardIds(
  db: Db,
  userId: string,
  themeId: string | undefined,
  size: number,
  { withForms = false, withExamples = false } = {},
) {
  const rows = db
    .select({ id: cards.id, lexemeId: cards.lexemeId })
    .from(cards)
    .innerJoin(
      userLexemes,
      and(eq(userLexemes.userId, cards.userId), eq(userLexemes.lexemeId, cards.lexemeId)),
    )
    .where(
      and(
        eq(cards.userId, userId),
        ne(cards.state, CARD_STATE.new),
        eq(cards.suspended, false),
        themeId
          ? inArray(
              cards.lexemeId,
              sql`(select ${themeLexemes.lexemeId} from ${themeLexemes} where ${themeLexemes.themeId} = ${themeId})`,
            )
          : undefined,
        withForms
          ? sql`exists (select 1 from ${lexemes} where ${lexemes.id} = ${cards.lexemeId} and ${lexemes.forms} is not null)`
          : undefined,
        withExamples
          ? sql`exists (select 1 from ${exampleSentences} where ${exampleSentences.lexemeId} = ${cards.lexemeId} and ${exampleSentences.translation} is not null)`
          : undefined,
      ),
    )
    .orderBy(
      ...(withForms ? [sql`case when ${cards.direction} = 'recall' then 0 else 1 end`] : []),
      asc(cards.stability),
      desc(userLexemes.incorrectCount),
      asc(cards.id),
    )
    .limit(size * 3)
    .all();
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const r of rows) {
    if (seen.has(r.lexemeId)) continue;
    seen.add(r.lexemeId);
    ids.push(r.id);
    if (ids.length === size) break;
  }
  return ids;
}

export function buildLesson(
  db: Db,
  userId: string,
  opts: { themeId?: string; mode: LessonMode; size: number; tzOffset: number },
  now = new Date(),
  rand: () => number = Math.random,
): LessonDto {
  let lessonCards: ReviewCardDto[];
  let remaining = 0;
  if (opts.mode === 'due') {
    const queue = buildQueue(
      db,
      userId,
      { themeId: opts.themeId, tzOffset: opts.tzOffset, limit: opts.size },
      now,
    );
    lessonCards = queue.cards;
    remaining = Math.max(0, queue.dueCount + queue.newCount - lessonCards.length);
  } else {
    lessonCards = hydrateCards(
      db,
      userId,
      weakestCardIds(db, userId, opts.themeId, opts.size, {
        withForms: opts.mode === 'drill',
        withExamples: opts.mode === 'translate',
      }),
      now,
    );
    lessonCards = shuffle(lessonCards, rand);
  }
  if (!lessonCards.length) return { mode: opts.mode, items: [], remaining };

  const { nativeLang } = getOrCreateProfile(db, userId);
  const { words, themesOf } = loadPool(db, userId, nativeLang);
  const states = cardStates(
    db,
    userId,
    lessonCards.map((c) => c.cardId),
  );

  const items = lessonCards.map((card, i): LessonItemDto => {
    const own = themesOf.get(card.lexemeId) ?? new Set<string>();
    const candidates = words
      .filter((w) => w.lang === card.lang)
      .map((w) => ({
        ...w,
        sameTheme: opts.themeId
          ? !!themesOf.get(w.id)?.has(opts.themeId)
          : [...(themesOf.get(w.id) ?? [])].some((t) => own.has(t)),
      }));
    const target: ChoiceCandidate = {
      id: card.lexemeId,
      lemma: card.lemma,
      pos: card.pos,
      gender: card.gender,
      translations: card.translations,
      hasImage: !!card.image,
      sameTheme: true,
    };
    const distractors = (mode: ChoiceMode) =>
      pickDistractors(target, candidates, {
        mode,
        count: OPTION_COUNT - 1,
        lang: card.lang,
        nativeLang,
        rand,
      }) as PoolWord[];

    const textMode: ChoiceMode = card.direction === 'recognition' ? 'meaning' : 'lemma';
    const textDistractors = distractors(textMode);
    const pictureDistractors = card.image ? distractors('image') : [];
    const cloze =
      card.examples
        .map((e) => {
          const c = buildCloze(e.text, e.cloze, card.lang);
          return c && { ...c, translation: e.translation };
        })
        .find((c) => c !== null) ?? null;
    const state = states.get(card.cardId);
    const drill = pickDrill(card, rand);
    const sentence =
      card.examples
        .map((e) => {
          const s = buildScramble(e.text, rand);
          return s && { ...s, translation: e.translation };
        })
        .find((s) => s !== null) ?? null;
    const translatable = card.examples.find((e) => e.translation);
    const kind: ExerciseKind =
      opts.mode === 'drill'
        ? 'drill'
        : opts.mode === 'translate'
          ? 'translate'
          : chooseExercise({
              direction: card.direction,
              state: state?.state ?? CARD_STATE.new,
              stability: state?.stability ?? 0,
              hasImage: !!card.image,
              canChoosePicture: pictureDistractors.length >= 2,
              canChooseText: textDistractors.length >= 2 && card.translations.length > 0,
              hasCloze: !!cloze,
              hasDrill: !!drill,
              hasSentence: !!sentence,
              rand,
            });

    let options: LessonOptionDto[] | null = null;
    if (kind === 'choose_picture') {
      options = shuffle(
        [option(card, 'image'), ...pictureDistractors.map((d) => option(d, 'image'))],
        rand,
      );
    } else if (
      kind === 'choose_meaning' ||
      kind === 'choose_word' ||
      // A new word that comes back in the same lesson is asked as "pick the meaning".
      (kind === 'intro' && card.direction === 'recognition' && textDistractors.length >= 2)
    ) {
      options = shuffle(
        [option(card, textMode), ...textDistractors.map((d) => option(d, textMode))],
        rand,
      );
    }
    return {
      key: `${i}-${card.cardId}`,
      kind,
      card,
      options,
      cloze: kind === 'cloze' ? cloze : null,
      drill: kind === 'drill' ? drill : null,
      sentence: kind === 'build_sentence' ? sentence : null,
      translate:
        kind === 'translate' && translatable?.translation
          ? { source: translatable.translation, reference: translatable.text }
          : null,
    };
  });
  return {
    mode: opts.mode,
    // A drill needs a form to ask for, a translation a sentence.
    items: items.filter(
      (item) =>
        (item.kind !== 'drill' || item.drill) && (item.kind !== 'translate' || item.translate),
    ),
    remaining,
  };
}

/**
 * Extra practice outside the schedule: counts the exposure and the result for the word, but
 * leaves its cards (FSRS state) alone.
 */
export function recordPractice(
  db: Db,
  userId: string,
  input: { lexemeId: string; exerciseType: ExerciseType; correct: boolean },
  now = new Date(),
) {
  const own = db
    .select({ lexemeId: userLexemes.lexemeId })
    .from(userLexemes)
    .where(and(eq(userLexemes.userId, userId), eq(userLexemes.lexemeId, input.lexemeId)))
    .get();
  if (!own) throw new HTTPException(404, { message: 'Word not found in your dictionary' });
  db.transaction((tx) => {
    tx.insert(exposures)
      .values({ userId, lexemeId: input.lexemeId, context: input.exerciseType, at: now })
      .run();
    tx.update(userLexemes)
      .set({
        exposureCount: sql`${userLexemes.exposureCount} + 1`,
        ...(input.correct
          ? { correctCount: sql`${userLexemes.correctCount} + 1` }
          : { incorrectCount: sql`${userLexemes.incorrectCount} + 1` }),
        lastSeenAt: now,
      })
      .where(and(eq(userLexemes.userId, userId), eq(userLexemes.lexemeId, input.lexemeId)))
      .run();
  });
}
