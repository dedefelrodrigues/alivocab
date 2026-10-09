import {
  type CefrLevel,
  type GrammarOptions,
  type ListeningOptions,
  languageName,
} from '@alivocab/shared';

export const LISTENING_PROMPT_VERSION = 'listening-script@1';
export const GRAMMAR_PROMPT_VERSION = 'grammar-note@1';

export type MaterialWord = {
  lemma: string;
  pos: string;
  translation: string | null;
  forms?: Record<string, string> | null;
};

type Base = {
  targetLang: string;
  nativeLang: string;
  themeName: string;
  words: readonly MaterialWord[];
};

const levelText = (level: CefrLevel | null) =>
  level ? `CEFR ${level}` : 'A2 (simple, everyday language)';

const wordList = (words: readonly MaterialWord[]) =>
  words
    .map((w) => `- ${w.lemma} (${w.pos}${w.translation ? `: ${w.translation}` : ''})`)
    .join('\n');

export function buildListeningPrompt(input: Base & { options: ListeningOptions }): string {
  const target = languageName(input.targetLang);
  const native = languageName(input.nativeLang);
  const { style, length, level } = input.options;
  const lines = length === 'short' ? '8 to 12' : '16 to 22';
  const kind =
    style === 'dialogue'
      ? `a natural dialogue between two people (${lines} lines, alternating speakers) in a situation that fits the theme`
      : `a short story or monologue told by one narrator (${lines} sentences, one sentence per line)`;
  return [
    `You are an expert ${target} teacher writing listening practice for a learner whose native language is ${native}.`,
    '',
    `Theme: "${input.themeName}". Level: ${levelText(level)}.`,
    `Write ${kind}. Use as many of these ${target} words as fit naturally (correctly inflected):`,
    wordList(input.words),
    '',
    'Rules:',
    `- Keep sentences short and natural, as people really speak. Use common first names typical for ${target} speakers.`,
    `- Each line has a natural ${native} translation.`,
    `- Add 3 or 4 comprehension questions in ${native} about the content, each with 3 or 4 options in ${native}; "answer" is the index (starting at 0) of the correct option.`,
    '',
    'Output ONLY this JSON, no commentary:',
    '```json',
    JSON.stringify(
      {
        title: `<short ${target} title>`,
        speakers: [{ id: 'A', name: '<first name>' }],
        lines: [{ speaker: 'A', text: `<${target} line>`, translation: `<${native} translation>` }],
        questions: [
          {
            question: `<${native} question>`,
            options: ['<option>', '<option>', '<option>'],
            answer: 0,
          },
        ],
      },
      null,
      2,
    ),
    '```',
  ].join('\n');
}

export function buildGrammarPrompt(input: Base & { options: GrammarOptions }): string {
  const target = languageName(input.targetLang);
  const native = languageName(input.nativeLang);
  const { focus, level } = input.options;
  const words = input.words
    .map((w) => {
      const forms =
        w.forms && Object.keys(w.forms).length
          ? `; forms: ${Object.entries(w.forms)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')}`
          : '';
      return `- ${w.lemma} (${w.pos}${w.translation ? `: ${w.translation}` : ''}${forms})`;
    })
    .join('\n');
  return [
    `You are an expert ${target} teacher. Write a short grammar lesson in ${native} for a learner at ${levelText(level)}, built around the vocabulary of the theme "${input.themeName}":`,
    words,
    '',
    focus
      ? `Topic: ${focus}. Explain it using these words.`
      : 'Choose the 2 or 3 grammar points these words need most (for example the cases or verb forms they appear in, gender agreement, or aspect pairs) and explain them using these words.',
    '',
    'Rules:',
    `- Explanations are in ${native}, clear and practical, for a learner (no linguistics jargon without explaining it).`,
    `- Every example is a short ${target} sentence using the theme words, with its ${native} translation.`,
    '- Add a small table where it helps (e.g. a word in different cases, or a verb in different persons); otherwise use null.',
    '- End with 2 or 3 short tips or common mistakes.',
    '',
    'Output ONLY this JSON, no commentary:',
    '```json',
    JSON.stringify(
      {
        title: `<${native} title>`,
        summary: `<one or two ${native} sentences on what this lesson covers>`,
        sections: [
          {
            heading: '<topic>',
            explanation: `<${native} explanation>`,
            examples: [{ text: `<${target} sentence>`, translation: `<${native}>` }],
            table: { headers: ['<column>', '<column>'], rows: [['<cell>', '<cell>']] },
          },
        ],
        tips: [`<${native} tip>`],
      },
      null,
      2,
    ),
    '```',
  ].join('\n');
}
