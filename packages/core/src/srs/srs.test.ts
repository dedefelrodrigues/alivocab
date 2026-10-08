import { describe, expect, it } from 'vitest';
import { CARD_STATE, formatInterval, previewCard, reviewCard } from './scheduler.ts';
import { seedCards } from './seed.ts';
import { deriveStatus, nextStatus } from './status.ts';

const now = new Date('2026-10-08T10:00:00Z');
const DAY = 86_400_000;
const days = (d: Date) => (d.getTime() - now.getTime()) / DAY;

describe('seedCards', () => {
  it('makes both cards new for unknown and untagged words', () => {
    for (const status of ['unknown', 'untagged'] as const) {
      const { recognition, recall } = seedCards(status, now);
      expect(recognition.state).toBe(CARD_STATE.new);
      expect(recall.state).toBe(CARD_STATE.new);
      expect(recognition.due.getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it('seeds recognize: recognition learned (1–3d), recall new', () => {
    const { recognition, recall } = seedCards('recognize', now, () => 0.5);
    expect(recognition).toMatchObject({ state: CARD_STATE.review, stability: 4, reps: 1 });
    expect(days(recognition.due)).toBe(2);
    expect(recall.state).toBe(CARD_STATE.new);
  });

  it('seeds known with long, fuzzed intervals', () => {
    const low = seedCards('known', now, () => 0);
    const high = seedCards('known', now, () => 1);
    expect(days(low.recognition.due)).toBe(20);
    expect(days(high.recognition.due)).toBe(40);
    expect(days(low.recall.due)).toBe(7);
    expect(days(high.recall.due)).toBe(14);
  });

  it('produces cards FSRS can schedule further', () => {
    const { recognition } = seedCards('recognize', now, () => 0.5);
    const later = new Date(recognition.due);
    const next = reviewCard(recognition, 'good', later);
    expect(next.state).toBe(CARD_STATE.review);
    expect(next.stability).toBeGreaterThan(4);
    expect(next.due.getTime()).toBeGreaterThan(later.getTime() + 3 * DAY);
  });
});

describe('reviewCard / previewCard', () => {
  it('orders the preview intervals again < hard ≤ good < easy for a new card', () => {
    const { recognition } = seedCards('unknown', now);
    const p = previewCard(recognition, now);
    expect(p.again.getTime()).toBeLessThan(p.good.getTime());
    expect(p.hard.getTime()).toBeLessThanOrEqual(p.good.getTime());
    expect(p.good.getTime()).toBeLessThan(p.easy.getTime());
  });

  it('keeps a failed new card in learning with a short step', () => {
    const { recognition } = seedCards('unknown', now);
    const next = reviewCard(recognition, 'again', now);
    expect(next.state).toBe(CARD_STATE.learning);
    expect(next.due.getTime() - now.getTime()).toBeLessThan(15 * 60_000);
  });
});

describe('status', () => {
  it('derives known / recognize / unknown from card stability', () => {
    expect(deriveStatus(seedCards('known', now))).toBe('recognize'); // recall stability 10 < 21
    const strong = { ...seedCards('known', now).recall, stability: 25 };
    expect(deriveStatus({ recognition: seedCards('known', now).recognition, recall: strong })).toBe(
      'known',
    );
    expect(deriveStatus(seedCards('unknown', now))).toBe('unknown');
  });

  it('only moves in the direction of the result', () => {
    const learned = seedCards('recognize', now);
    expect(nextStatus('unknown', learned, true)).toBe('recognize');
    expect(nextStatus('known', learned, true)).toBe('known'); // success never downgrades
    expect(nextStatus('known', seedCards('unknown', now), false)).toBe('unknown');
    expect(nextStatus('unknown', learned, false)).toBe('unknown'); // failure never upgrades
    expect(nextStatus('untagged', seedCards('unknown', now), false)).toBe('unknown');
  });
});

describe('formatInterval', () => {
  it.each([
    [30_000, '<1m'],
    [10 * 60_000, '10m'],
    [5 * 3_600_000, '5h'],
    [4 * DAY, '4d'],
    [65 * DAY, '2mo'],
    [550 * DAY, '1.5y'],
  ])('%i ms → %s', (ms, label) => {
    expect(formatInterval(new Date(now.getTime() + ms), now)).toBe(label);
  });
});
