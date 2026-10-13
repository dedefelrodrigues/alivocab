/** Progress statistics (the Stats page). */
import { z } from 'zod';
import type { PartOfSpeech, WordStatus } from './enums.ts';
import { learningLangParam } from './languages.ts';
import type { PictureDto, StatusCounts } from './vocab.ts';

export const statsQuerySchema = z.object({
  themeId: z.string().min(1).optional(),
  lang: learningLangParam,
  tzOffset: z.coerce.number().int().min(-840).max(840).default(0),
  days: z.coerce.number().int().min(7).max(90).default(30),
});

export type RetentionDto = { correct: number; total: number };

export type WordStatsDto = {
  lexemeId: string;
  lemma: string;
  lang: string;
  pos: PartOfSpeech;
  translations: string[];
  status: WordStatus;
  image: PictureDto | null;
  /** Times the word was shown (flashcards, exercises, proposals). */
  exposures: number;
  /** Graded reviews (both directions). */
  reviews: number;
  correct: number;
  incorrect: number;
  /** Times a learned card was forgotten. */
  lapses: number;
  /** Next review (ISO), or null if not scheduled yet. */
  nextDue: string | null;
};

export type StatsDto = {
  /** One entry per local day, oldest first. */
  daily: Array<{ date: string; reviews: number; correct: number; newWords: number }>;
  /** Share of reviews answered right in the period: all, young cards, mature cards (≥ 21 d). */
  retention: { all: RetentionDto; young: RetentionDto; mature: RetentionDto };
  streakDays: number;
  /** Time spent answering in the period (ms, from response times). */
  timeMs: number;
  status: StatusCounts;
  totals: { words: number; reviews: number; exposures: number };
  words: WordStatsDto[];
};
