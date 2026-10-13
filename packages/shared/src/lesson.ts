/** Lessons: a mix of exercises over due (or, for extra practice, weak) words. */
import { z } from 'zod';
import { EXERCISE_TYPES, type ExerciseKind } from './enums.ts';
import { learningLangParam } from './languages.ts';
import type { ReviewCardDto } from './review.ts';
import type { PictureDto } from './vocab.ts';

export const LESSON_MODES = [
  /** Due reviews and new words; answers update the schedule. */
  'due',
  /** Extra practice on the weakest words, outside the schedule (counts exposures only). */
  'practice',
  /** Grammar drills (forms) on words that have them, outside the schedule like `practice`. */
  'drill',
  /** Translating example sentences into the target language, outside the schedule. */
  'translate',
] as const;
export type LessonMode = (typeof LESSON_MODES)[number];

export const lessonQuerySchema = z.object({
  themeId: z.string().min(1).optional(),
  lang: learningLangParam,
  mode: z.enum(LESSON_MODES).default('due'),
  size: z.coerce.number().int().min(3).max(40).default(15),
  tzOffset: z.coerce.number().int().min(-840).max(840).default(0),
});

export type LessonOptionDto = {
  lexemeId: string;
  /** The word or its meaning; empty for picture options. */
  text: string;
  image: PictureDto | null;
};

export type LessonItemDto = {
  /** Unique within the lesson. */
  key: string;
  kind: ExerciseKind;
  card: ReviewCardDto;
  /**
   * Choices for `choose_*` exercises (the right one has the card's `lexemeId`). An `intro` may
   * carry meaning options too, used when the new word comes back later in the lesson.
   */
  options: LessonOptionDto[] | null;
  /** The blanked sentence for `cloze`. */
  cloze: { before: string; answer: string; after: string; translation: string | null } | null;
  /** Shuffled words of an example sentence for `build_sentence`. */
  sentence: { tokens: string[]; answer: string[]; end: string; translation: string | null } | null;
  /** The sentence to translate for `translate` (source in the native language). */
  translate: { source: string; reference: string } | null;
  /** The form to produce for `drill`. */
  drill: {
    formKey: string;
    label: string;
    frame: { before: string; after: string; translation: string } | null;
    answer: string;
  } | null;
};

export type LessonDto = {
  mode: LessonMode;
  items: LessonItemDto[];
  /** Due reviews and new words left after this lesson (mode `due`). */
  remaining: number;
};

/** Result of an extra-practice exercise (mode `practice`), which doesn't touch the schedule. */
export const practiceResultSchema = z.object({
  lexemeId: z.string().min(1),
  exerciseType: z.enum(EXERCISE_TYPES),
  correct: z.boolean(),
});
