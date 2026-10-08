/**
 * FSRS scheduling (ts-fsrs) behind plain types that match the `cards` table, so the DB layer
 * and the UI never depend on ts-fsrs directly.
 */
import { REVIEW_RATINGS, type ReviewRatingName } from '@alivocab/shared';
import { type Card, fsrs, type Grade, generatorParameters, Rating, State } from 'ts-fsrs';

export const RATINGS = REVIEW_RATINGS;
export type ReviewRating = ReviewRatingName;

const GRADE: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

/** ts-fsrs State numbers, stored as-is in `cards.state`. */
export const CARD_STATE = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
} as const;

export type CardState = {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: Date | null;
};

export const scheduler = fsrs(
  generatorParameters({
    request_retention: 0.9,
    maximum_interval: 3650,
    enable_fuzz: true,
    enable_short_term: true,
  }),
);

function toFsrs(c: CardState): Card {
  return {
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsedDays,
    scheduled_days: c.scheduledDays,
    learning_steps: c.learningSteps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as State,
    last_review: c.lastReview ?? undefined,
  };
}

function fromFsrs(c: Card): CardState {
  return {
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    lastReview: c.last_review ?? null,
  };
}

/** Applies a rating and returns the next card state. */
export function reviewCard(card: CardState, rating: ReviewRating, now: Date): CardState {
  return fromFsrs(scheduler.next(toFsrs(card), now, GRADE[rating]).card);
}

/** Next due date for each possible rating (for the interval hints on the buttons). */
export function previewCard(card: CardState, now: Date): Record<ReviewRating, Date> {
  const preview = scheduler.repeat(toFsrs(card), now);
  return {
    again: preview[Rating.Again].card.due,
    hard: preview[Rating.Hard].card.due,
    good: preview[Rating.Good].card.due,
    easy: preview[Rating.Easy].card.due,
  };
}

/** Probability (0–1) of recalling the card right now. */
export function retrievability(card: CardState, now: Date): number {
  return card.state === CARD_STATE.new ? 0 : scheduler.get_retrievability(toFsrs(card), now, false);
}

/** Compact human interval: "<1m", "10m", "3h", "4d", "2mo", "1.5y". */
export function formatInterval(due: Date, now: Date): string {
  const minutes = (due.getTime() - now.getTime()) / 60_000;
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  const years = days / 365;
  return `${years < 10 ? years.toFixed(1).replace(/\.0$/, '') : Math.round(years)}y`;
}
