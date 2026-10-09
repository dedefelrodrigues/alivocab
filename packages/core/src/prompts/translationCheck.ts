import {
  languageName,
  type TranslationFeedback,
  translationFeedbackSchema,
} from '@alivocab/shared';
import { extractJsonValue } from '../import/extract.ts';
import type { MaterialParse } from '../materials/parse.ts';

export const TRANSLATION_CHECK_PROMPT_VERSION = 'translation-check@1';

export function buildTranslationCheckPrompt(input: {
  lang: string;
  nativeLang: string;
  source: string;
  reference: string;
  answer: string;
}): string {
  const target = languageName(input.lang);
  const native = languageName(input.nativeLang);
  return [
    `You are a friendly, precise ${target} teacher. A learner whose native language is ${native} translated a sentence into ${target}.`,
    '',
    `${native} sentence: ${input.source}`,
    `One correct ${target} translation: ${input.reference}`,
    `Learner's translation: ${input.answer}`,
    '',
    `Decide whether the learner's translation is right. Other word orders, synonyms and equally natural phrasings are fine: judge meaning, grammar and spelling (including diacritics), not similarity to the given translation.`,
    '- "verdict": "correct" (right and natural), "acceptable" (understandable, small issues) or "wrong" (meaning or grammar is off).',
    `- "corrected": the learner's sentence with the fewest changes that make it right (identical if it is already right).`,
    `- "explanation": 1–3 short sentences in ${native}.`,
    `- "mistakes": each problem as the wrong part, the right part and a short ${native} note (empty if none).`,
    '',
    'Output ONLY this JSON:',
    '```json',
    JSON.stringify(
      {
        verdict: 'correct',
        corrected: `<${target} sentence>`,
        explanation: `<${native}>`,
        mistakes: [{ wrong: '<…>', right: '<…>', note: `<${native}>` }],
      },
      null,
      2,
    ),
    '```',
  ].join('\n');
}

export function parseTranslationCheck(raw: string): MaterialParse<TranslationFeedback> {
  const value = extractJsonValue(raw);
  const checked = translationFeedbackSchema.safeParse(value);
  if (!checked.success) return { ok: false, error: 'The answer was not in the expected format' };
  return { ok: true, content: checked.data };
}
