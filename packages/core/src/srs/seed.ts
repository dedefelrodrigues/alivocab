import type { CardDirection, WordStatus } from '@alivocab/shared';
import { createEmptyCard } from 'ts-fsrs';
import { CARD_STATE, type CardState } from './scheduler.ts';

const DAY = 86_400_000;

function newCard(now: Date): CardState {
  const c = createEmptyCard(now);
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
    lastReview: null,
  };
}

/**
 * A card that behaves as if it had been reviewed successfully today with the given stability,
 * due after a fuzzed interval within [minDays, maxDays].
 */
function seededReview(
  now: Date,
  stability: number,
  minDays: number,
  maxDays: number,
  rand: () => number,
): CardState {
  const days = minDays + Math.round(rand() * (maxDays - minDays));
  return {
    due: new Date(now.getTime() + days * DAY),
    stability,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: days,
    learningSteps: 0,
    reps: 1,
    lapses: 0,
    state: CARD_STATE.review,
    lastReview: now,
  };
}

/**
 * Initial FSRS state for both cards of a word, from the learner's tag (PLAN.md §5.2):
 * - don't know / untagged: both new (the recall card only enters the queue once the
 *   recognition card has been seen)
 * - recognize: recognition card already learned (≈4d stability), recall card new
 * - known: both learned with long intervals, so they only come back occasionally
 */
export function seedCards(
  status: WordStatus,
  now: Date,
  rand: () => number = Math.random,
): Record<CardDirection, CardState> {
  switch (status) {
    case 'known':
      return {
        recognition: seededReview(now, 30, 20, 40, rand),
        recall: seededReview(now, 10, 7, 14, rand),
      };
    case 'recognize':
      return { recognition: seededReview(now, 4, 1, 3, rand), recall: newCard(now) };
    default:
      return { recognition: newCard(now), recall: newCard(now) };
  }
}
