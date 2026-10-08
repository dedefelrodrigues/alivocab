import { type CefrLevel, languageName, type ProposalFormat } from '@alivocab/shared';

/** Bump when the template changes in a way that affects output (stored with each generation). */
export const VOCAB_PROMPT_VERSION = 'vocab-proposal@1';

export type VocabPromptInput = {
  targetLang: string;
  nativeLang: string;
  themeName: string;
  description?: string;
  count: number;
  level: CefrLevel | null;
  format: ProposalFormat;
  /** Lemmas to leave out (already in the theme or produced by an earlier batch). */
  avoid?: readonly string[];
};

/** Grammatical form keys we ask for, per target language. */
const FORM_GUIDE: Record<string, string> = {
  pl: [
    'nouns: gen_sg, nom_pl, ins_sg',
    'verbs: pres_1sg, pres_2sg, pres_3pl (for perfective verbs use the future forms), past_m',
    'adjectives: f, n, nom_pl_virile',
  ].join('; '),
  pt: 'nouns: pl; verbs: pres_1sg, pres_3sg, past_1sg (pretérito perfeito); adjectives: f, pl',
  es: 'nouns: pl; verbs: pres_1sg, pres_3sg, past_1sg (pretérito indefinido); adjectives: f, pl',
  fr: 'nouns: pl; verbs: pres_1sg, pres_3pl, past_participle; adjectives: f, pl',
  it: 'nouns: pl; verbs: pres_1sg, pres_3sg, past_participle; adjectives: f, pl',
  de: 'nouns: gen_sg, nom_pl; verbs: pres_3sg, praeteritum_3sg, perfekt (e.g. "hat gemacht"); adjectives: comparative',
  uk: 'nouns: gen_sg, nom_pl; verbs: pres_1sg, pres_3pl (future for perfective), past_m; adjectives: f, n',
  cs: 'nouns: gen_sg, nom_pl; verbs: pres_1sg, pres_3pl, past_m; adjectives: f, n',
};
const DEFAULT_FORM_GUIDE = 'nouns: plural; verbs: 3rd person singular present and simple past';

/** Languages with grammatical aspect pairs worth recording. */
const ASPECT_LANGS = new Set(['pl', 'uk', 'cs', 'ru', 'sk']);

const CSV_HEADER =
  'lemma;translation;pos;gender;aspect;aspect_pair;forms;pronunciation;example;example_translation;cloze;notes';

/**
 * Builds the vocabulary-proposal prompt. The same text is used for API providers, in-browser
 * models and the copy-paste flow, and the import parser accepts its output in either format.
 */
export function buildVocabPrompt(input: VocabPromptInput): string {
  const target = languageName(input.targetLang);
  const native = languageName(input.nativeLang);
  const hasAspect = ASPECT_LANGS.has(input.targetLang);
  const forms = FORM_GUIDE[input.targetLang] ?? DEFAULT_FORM_GUIDE;
  const level = input.level
    ? `CEFR level ${input.level}: choose words a learner at this level should learn next`
    : 'a mix of everyday and slightly more advanced words';

  const lines: string[] = [
    `You are an expert ${target} teacher and lexicographer. Propose ${input.count} ${target} vocabulary items for a learner whose native language is ${native}.`,
    '',
    `Theme: "${input.themeName}"`,
  ];
  if (input.description) lines.push(`Details: ${input.description}`);
  lines.push(
    `Level: ${level}.`,
    '',
    'Rules:',
    `- Exactly ${input.count} distinct items, ordered from most to least useful for this theme.`,
    '- Mostly nouns, verbs and adjectives, plus a few useful adverbs or short fixed phrases. No proper nouns.',
    '- "lemma" is the dictionary form: nouns in nominative singular (plural only for plural-only nouns), verbs in the infinitive, adjectives in masculine singular. Phrases as commonly written.',
    '- "pos" is one of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, numeral, particle, interjection, phrase.',
    '- "gender" for nouns: m, f or n (use mp / nmp only for plural-only nouns: virile / non-virile). Empty for other parts of speech.',
  );
  if (hasAspect) {
    lines.push(
      '- "aspect" for verbs: impf (imperfective) or pf (perfective). "aspect_pair": the other verb of the pair, if one exists.',
    );
  }
  lines.push(
    `- "translations": 1–3 short ${native} translations, most common first.`,
    `- "forms": key grammatical forms where relevant (${forms}).`,
    '- "pronunciation": IPA without slashes.',
    `- "examples": one natural, level-appropriate ${target} sentence using the word, with its ${native} translation, and "cloze" = the word exactly as it appears in the sentence (inflected form).`,
    '- "notes": optional short tip (irregularity, false friend, register). Leave empty if nothing useful.',
  );
  if (input.avoid?.length) {
    lines.push(`- Do NOT include any of these (already known): ${input.avoid.join(', ')}.`);
  }
  lines.push('');

  if (input.format === 'json') {
    lines.push(
      'Answer with ONLY a JSON object, no commentary, in exactly this shape:',
      '```json',
      '{"words":[{"lemma":"","pos":"noun","gender":"m",' +
        (hasAspect ? '"aspect":null,"aspect_pair":null,' : '') +
        '"translations":[""],"forms":{"key":"form"},"pronunciation":"","examples":[{"text":"","translation":"","cloze":""}],"notes":""}]}',
      '```',
    );
  } else {
    lines.push(
      'Answer with ONLY a CSV code block, semicolon-separated, with this exact header row:',
      '```csv',
      CSV_HEADER,
      '```',
      'Multiple translations are separated by "|". "forms" is written as key=value|key=value. Quote fields that contain semicolons.',
    );
  }

  return lines.join('\n');
}
