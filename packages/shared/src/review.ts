/** Spaced-repetition review contracts (queue, grading, dashboard summary). */
import { z } from 'zod';
import {
  type Aspect,
  type CardDirection,
  EXERCISE_TYPES,
  type Gender,
  type PartOfSpeech,
  type WordStatus,
} from './enums.ts';

export const REVIEW_RATINGS = ['again', 'hard', 'good', 'easy'] as const;
export type ReviewRatingName = (typeof REVIEW_RATINGS)[number];

/** Learning cards due within this window are shown again in the same session. */
export const REQUEUE_WINDOW_MS = 20 * 60_000;

/** `Date.getTimezoneOffset()` of the client, so "today" means the learner's day. */
const tzOffset = z.coerce.number().int().min(-840).max(840).default(0);

export const queueQuerySchema = z.object({
  themeId: z.string().min(1).optional(),
  tzOffset,
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const summaryQuerySchema = z.object({ tzOffset });

export const gradeSchema = z.object({
  rating: z.enum(REVIEW_RATINGS),
  exerciseType: z.enum(EXERCISE_TYPES).default('flashcard'),
  responseMs: z.number().int().min(0).max(3_600_000).optional(),
});
export type GradeRequest = z.input<typeof gradeSchema>;

export type ReviewCardDto = {
  cardId: string;
  lexemeId: string;
  direction: CardDirection;
  isNew: boolean;
  lang: string;
  nativeLang: string;
  lemma: string;
  pos: PartOfSpeech;
  gender: Gender | null;
  aspect: Aspect | null;
  aspectPair: string | null;
  forms: Record<string, string> | null;
  pronunciation: string | null;
  translations: string[];
  examples: Array<{ text: string; translation: string | null; cloze: string | null }>;
  note: string | null;
  mnemonic: string | null;
  status: WordStatus;
  /** Next interval per rating, e.g. { again: "1m", good: "3d" }. */
  intervals: Record<ReviewRatingName, string>;
};

export type ReviewQueueDto = {
  cards: ReviewCardDto[];
  /** Due reviews remaining today (after the daily limit). */
  dueCount: number;
  /** New cards remaining today (after the daily limit). */
  newCount: number;
  reviewedToday: number;
  newToday: number;
  limits: { newPerDay: number; reviewsPerDay: number };
};

export type GradeResultDto = {
  cardId: string;
  due: string;
  status: WordStatus;
  /** Set when the card is due again within the session window (show it again later). */
  requeue: ReviewCardDto | null;
};

export type ReviewSummaryDto = {
  dueNow: number;
  newAvailable: number;
  reviewedToday: number;
  streakDays: number;
  /** Reviews due on each of the next 7 days (local dates, YYYY-MM-DD). */
  forecast: Array<{ date: string; count: number }>;
  themes: Array<{ id: string; name: string; due: number; new: number }>;
};
