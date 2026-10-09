import { languageName } from '@alivocab/shared';

/** Bump when the template changes in a way that affects output (stored with each generation). */
export const EXAMPLES_PROMPT_VERSION = 'example-sentences@1';

export type ExamplesPromptInput = {
  targetLang: string;
  nativeLang: string;
  /** The words that need sentences (with a meaning, so the right sense is used). */
  words: ReadonlyArray<{ lemma: string; pos: string; translation: string | null }>;
  /** Sentences per word. */
  perWord?: number;
  themeName?: string;
};

/**
 * Asks for short example sentences for given words, in the same JSON shape the vocabulary
 * import reads (so `parseVocabulary` validates the answer and finds the cloze form).
 */
export function buildExamplesPrompt(input: ExamplesPromptInput): string {
  const target = languageName(input.targetLang);
  const native = languageName(input.nativeLang);
  const perWord = input.perWord ?? 2;
  const list = input.words
    .map((w) => `- ${w.lemma} (${w.pos}${w.translation ? `: ${w.translation}` : ''})`)
    .join('\n');
  return [
    `You are an expert ${target} teacher. Write example sentences for a learner whose native language is ${native}.`,
    input.themeName ? `The words belong to the theme "${input.themeName}".` : '',
    '',
    `For EACH of these ${input.words.length} ${target} words, write ${perWord === 1 ? 'one short, natural sentence' : `${perWord} short, natural sentences`} (4–10 words) that a learner at A2–B1 level understands and that show the word in its usual meaning:`,
    list,
    '',
    'Rules:',
    `- Use the word in a natural, correctly inflected form; vary the forms between sentences (e.g. a different case or person).`,
    `- "cloze" is the word form EXACTLY as it appears in that sentence (same spelling and case), so it can be blanked out.`,
    `- "example_translation" is a natural ${native} translation of the sentence.`,
    '- Keep "lemma", "pos" and "translation" exactly as given.',
    '',
    'Output ONLY a JSON array, no commentary, one object per sentence:',
    '```json',
    JSON.stringify(
      [
        {
          lemma: '<word as given>',
          pos: '<pos as given>',
          translation: '<meaning as given>',
          example: `<${target} sentence>`,
          example_translation: `<${native} translation>`,
          cloze: '<the word form as used in the sentence>',
        },
      ],
      null,
      2,
    ),
    '```',
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n');
}
