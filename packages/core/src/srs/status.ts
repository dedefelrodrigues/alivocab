import type { WordStatus } from '@alivocab/shared';
import { CARD_STATE, type CardState } from './scheduler.ts';

const RANK: Record<WordStatus, number> = { untagged: 0, unknown: 1, recognize: 2, known: 3 };

/** What the two cards say about how well the word is known (PLAN.md §5.3). */
export function deriveStatus(cards: { recognition: CardState; recall: CardState }): WordStatus {
  const solid = (c: CardState, days: number) =>
    c.state === CARD_STATE.review && c.stability >= days;
  if (solid(cards.recognition, 21) && solid(cards.recall, 21)) return 'known';
  // 4 days matches the stability a "recognize" tag seeds, so a fresh tag derives back to itself.
  if (solid(cards.recognition, 4)) return 'recognize';
  return 'unknown';
}

/**
 * Status after a review. It only moves in the direction of the result: a success can raise it,
 * a failure can lower it. So a manual "known" isn't downgraded by an easy answer, and a manual
 * "don't know" still climbs once the cards are learned.
 */
export function nextStatus(
  current: WordStatus,
  cards: { recognition: CardState; recall: CardState },
  success: boolean,
): WordStatus {
  const derived = deriveStatus(cards);
  if (success) return RANK[derived] > RANK[current] ? derived : current;
  return RANK[derived] < RANK[current] ? derived : current === 'untagged' ? 'unknown' : current;
}
