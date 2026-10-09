/**
 * Which exercise a card gets in a lesson, and how an answer maps to an FSRS rating
 * (PLAN.md §5.1 and §6).
 */
import type { ExerciseKind } from '@alivocab/shared';
import type { AnswerVerdict } from './answer.ts';

/** FSRS card states (mirrors `CARD_STATE`). */
const NEW = 0;
const REVIEW = 2;

export type ExerciseContext = {
  direction: 'recognition' | 'recall';
  state: number;
  /** Days; how established the memory is. */
  stability: number;
  hasImage: boolean;
  /** Enough other words with pictures to offer picture options. */
  canChoosePicture: boolean;
  /** Enough other words to offer text options. */
  canChooseText: boolean;
  hasCloze: boolean;
  /** The word has grammatical forms to drill. */
  hasDrill?: boolean;
  rand?: () => number;
};

/**
 * Easier exercises while a word is new or being learned, harder (typing) once it is established.
 * Falls back to a flashcard when no exercise is possible (e.g. too few words for options).
 */
export function chooseExercise(ctx: ExerciseContext): ExerciseKind {
  const rand = ctx.rand ?? Math.random;
  if (ctx.state === NEW && ctx.direction === 'recognition') return 'intro';

  if (ctx.direction === 'recognition') {
    if (ctx.hasImage && ctx.canChoosePicture && rand() < 0.5) return 'choose_picture';
    return ctx.canChooseText ? 'choose_meaning' : 'intro';
  }

  // Recall: choose while learning, then type (or fill in a sentence) once it's in review.
  const established = ctx.state === REVIEW && ctx.stability >= 2;
  if (!established) {
    if (ctx.canChooseText) return 'choose_word';
    return 'type_word';
  }
  // Established: rotate between a sentence gap, a form drill and plain typing.
  const kinds: ExerciseKind[] = [
    ...(ctx.hasCloze ? (['cloze'] as const) : []),
    ...(ctx.hasDrill ? (['drill'] as const) : []),
    'type_word',
  ];
  return kinds[Math.floor(rand() * kinds.length)] ?? 'type_word';
}

export type ExerciseRating = 'again' | 'hard' | 'good' | 'easy';

/** Answers typed this fast (ms) on an established card are rated Easy. */
export const FAST_ANSWER_MS = 5_000;

/**
 * Maps an exercise result to a rating: wrong → Again; almost right (accents, a typo) or helped by
 * a hint → Hard; right → Good; typed right, fast and unaided on a card that isn't new → Easy.
 * Multiple choice is never Easy (recognizing among options is easier than recalling).
 */
export function ratingFor(result: {
  verdict: AnswerVerdict;
  kind: ExerciseKind;
  hinted?: boolean;
  responseMs?: number;
  isNew?: boolean;
}): ExerciseRating {
  if (result.verdict === 'wrong') return 'again';
  if (result.verdict !== 'correct' || result.hinted) return 'hard';
  const typed = result.kind === 'type_word' || result.kind === 'cloze' || result.kind === 'drill';
  if (typed && !result.isNew && result.responseMs !== undefined) {
    if (result.responseMs <= FAST_ANSWER_MS) return 'easy';
  }
  return 'good';
}

/** The `exercise_type` recorded in review logs and exposures. */
export function exerciseTypeOf(
  kind: ExerciseKind,
): 'flashcard' | 'mcq' | 'typing' | 'cloze' | 'drill' {
  if (kind === 'intro') return 'flashcard';
  if (kind === 'drill') return 'drill';
  if (kind === 'cloze') return 'cloze';
  if (kind === 'type_word') return 'typing';
  return 'mcq';
}
