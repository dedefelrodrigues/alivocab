/** AI help in practice: checking a translation the free check couldn't confirm. */
import { z } from 'zod';
import { languageCodeSchema } from './languages.ts';

export const translationCheckRequestSchema = z.object({
  /** The sentence in the learner's native language. */
  source: z.string().trim().min(1).max(500),
  /** The stored translation (one right answer). */
  reference: z.string().trim().min(1).max(500),
  /** What the learner wrote. */
  answer: z.string().trim().min(1).max(500),
  lang: languageCodeSchema,
  nativeLang: languageCodeSchema,
  credentialId: z.string().min(1).optional(),
});

export const translationFeedbackSchema = z.object({
  /** correct = natural and right; acceptable = right with small issues; wrong = meaning or grammar off. */
  verdict: z.enum(['correct', 'acceptable', 'wrong']),
  /** The learner's sentence corrected (as close to theirs as possible). */
  corrected: z.string().trim().min(1).max(500),
  /** Short explanation in the native language. */
  explanation: z.string().trim().min(1).max(1200),
  mistakes: z
    .array(
      z.object({
        wrong: z.string().trim().max(120),
        right: z.string().trim().max(120),
        note: z.string().trim().max(300),
      }),
    )
    .max(8)
    .default([]),
});
export type TranslationFeedback = z.output<typeof translationFeedbackSchema>;
