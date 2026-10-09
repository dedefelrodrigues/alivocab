import { languageName } from '@alivocab/shared';
import { DEFAULT_FORM_GUIDE, FORM_GUIDE } from './vocabProposal.ts';

/** Bump when the template changes in a way that affects output (stored with each generation). */
export const FORMS_PROMPT_VERSION = 'grammar-forms@1';

export type FormsPromptInput = {
  targetLang: string;
  nativeLang: string;
  words: ReadonlyArray<{ lemma: string; pos: string; translation: string | null }>;
};

/**
 * Asks for the grammatical forms of given words (the same keys the vocabulary prompt uses), in
 * the JSON shape the vocabulary import reads.
 */
export function buildFormsPrompt(input: FormsPromptInput): string {
  const target = languageName(input.targetLang);
  const guide = FORM_GUIDE[input.targetLang] ?? DEFAULT_FORM_GUIDE;
  const list = input.words
    .map((w) => `- ${w.lemma} (${w.pos}${w.translation ? `: ${w.translation}` : ''})`)
    .join('\n');
  return [
    `You are an expert ${target} grammarian. Give the key grammatical forms of these ${input.words.length} ${target} words:`,
    list,
    '',
    'Rules:',
    `- "forms" uses exactly these keys, depending on the part of speech: ${guide}.`,
    '- Give each form as it is written, without pronouns or articles; leave out keys that do not apply (e.g. no plural for uncountable nouns).',
    '- Words that do not inflect (adverbs, conjunctions, set phrases) get "forms": {}.',
    '- Keep "lemma", "pos" and "translation" exactly as given.',
    '',
    'Output ONLY a JSON array, no commentary, one object per word:',
    '```json',
    JSON.stringify(
      [
        {
          lemma: '<word as given>',
          pos: '<pos as given>',
          translation: '<meaning as given>',
          forms: { '<form key>': '<form>' },
        },
      ],
      null,
      2,
    ),
    '```',
  ].join('\n');
}
