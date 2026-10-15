/** Vocabulary, proposal and theme contracts shared by core (parsing), api and web. */
import { z } from 'zod';
import type { ImageProvider } from './enums.ts';
import {
  ASPECTS,
  type Aspect,
  GENDERS,
  type Gender,
  PARTS_OF_SPEECH,
  type PartOfSpeech,
  SEARCH_PROVIDERS,
  type SearchProvider,
  WORD_STATUSES,
  type WordStatus,
} from './enums.ts';
import { learningLangParam } from './languages.ts';

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

export const PROPOSAL_FORMATS = ['json', 'csv'] as const;
export type ProposalFormat = (typeof PROPOSAL_FORMATS)[number];

export const MAX_WORDS_PER_REQUEST = 100;
export const MAX_WORDS_PER_SAVE = 200;

const nullableText = (max: number) => z.string().trim().max(max).nullable().default(null);

export const exampleSchema = z.object({
  text: z.string().trim().min(1).max(400),
  translation: nullableText(400),
  /** The word form exactly as it appears in `text` (for cloze exercises). */
  cloze: nullableText(80),
});

/** A fully normalized word, as produced by the import parser and accepted by save endpoints. */
export const wordSchema = z.object({
  lemma: z.string().trim().min(1).max(80),
  pos: z.enum(PARTS_OF_SPEECH),
  gender: z.enum(GENDERS).nullable().default(null),
  aspect: z.enum(ASPECTS).nullable().default(null),
  aspectPair: nullableText(80),
  translations: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
  forms: z.record(z.string().max(30), z.string().max(80)).nullable().default(null),
  pronunciation: nullableText(120),
  examples: z.array(exampleSchema).max(5).default([]),
  notes: nullableText(500),
  /** English photo search phrase. '' = the word can't be pictured; null = not provided. */
  imageQuery: z.string().trim().max(100).nullable().default(null),
});

export type VocabWord = z.output<typeof wordSchema>;
export type VocabExample = z.output<typeof exampleSchema>;

export type ImportIssue = {
  /** 1-based row/item number in the source, or null for whole-input problems. */
  row: number | null;
  severity: 'error' | 'warning';
  message: string;
  lemma?: string;
};

/** A proposed word enriched with what the user already has. */
export type ProposalWord = VocabWord & {
  /** Stable client key for list rendering (`lemma|pos`). */
  key: string;
  /** Set when the word is already in the user's dictionary. */
  existing: {
    lexemeId: string;
    status: WordStatus;
    themes: Array<{ id: string; name: string }>;
  } | null;
  /** True when the word is already linked to the theme being extended. */
  inTheme: boolean;
};

export type ProposalDto = {
  generationId: string;
  words: ProposalWord[];
  issues: ImportIssue[];
  rawOutput: string;
};

// ── Requests ────────────────────────────────────────────────────────────────

const themeContext = {
  themeName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  /** When adding words to an existing theme. */
  themeId: z.string().min(1).optional(),
  /** Language of a new theme (default: the active one). */
  lang: learningLangParam,
  count: z.number().int().min(5).max(MAX_WORDS_PER_REQUEST),
  level: z.enum(CEFR_LEVELS).nullable().default(null),
};

export const promptRequestSchema = z.object({
  ...themeContext,
  format: z.enum(PROPOSAL_FORMATS).default('json'),
});
export type PromptRequest = z.input<typeof promptRequestSchema>;

export const generateRequestSchema = z.object({
  ...themeContext,
  credentialId: z.string().min(1),
  model: z.string().trim().min(1).max(200).optional(),
});
export type GenerateRequest = z.input<typeof generateRequestSchema>;

export const importRequestSchema = z.object({
  raw: z.string().min(1).max(300_000),
  source: z.enum(['manual', 'browser']),
  model: z.string().trim().max(200).optional(),
  themeName: z.string().trim().max(80).optional(),
  themeId: z.string().min(1).optional(),
  lang: learningLangParam,
  /** The prompt that produced `raw`, kept for the generation log. */
  prompt: z.string().max(50_000).optional(),
});
export type ImportRequest = z.input<typeof importRequestSchema>;

export const taggedWordSchema = wordSchema.extend({
  status: z.enum(WORD_STATUSES).default('untagged'),
});
export type TaggedWord = z.input<typeof taggedWordSchema>;

export const saveWordsSchema = z.object({
  generationId: z.string().min(1).optional(),
  words: z.array(taggedWordSchema).min(1).max(MAX_WORDS_PER_SAVE),
});
export type SaveWordsRequest = z.input<typeof saveWordsSchema>;

export const createThemeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  /** Default: the active learning language. */
  lang: learningLangParam,
  generationId: z.string().min(1).optional(),
  words: z.array(taggedWordSchema).max(MAX_WORDS_PER_SAVE).default([]),
});
export type CreateThemeRequest = z.input<typeof createThemeSchema>;

export const themeListQuerySchema = z.object({ lang: learningLangParam });

export const themeUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).nullable(),
  })
  .partial();

export const statusUpdateSchema = z.object({ status: z.enum(WORD_STATUSES) });

/** Edits to a word. Shared dictionary fields are only editable by their sole user or an admin. */
export const wordUpdateSchema = z
  .object({
    gender: z.enum(GENDERS).nullable(),
    aspect: z.enum(ASPECTS).nullable(),
    aspectPair: z.string().trim().max(80).nullable(),
    forms: z.record(z.string().max(30), z.string().max(80)).nullable(),
    pronunciation: z.string().trim().max(120).nullable(),
    translations: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
    note: z.string().trim().max(500).nullable(),
    mnemonic: z.string().trim().max(500).nullable(),
  })
  .partial();
export type WordUpdate = z.infer<typeof wordUpdateSchema>;

export const SHARED_WORD_FIELDS = [
  'gender',
  'aspect',
  'aspectPair',
  'forms',
  'pronunciation',
  'translations',
] as const;

// ── Responses ───────────────────────────────────────────────────────────────

export type StatusCounts = Record<WordStatus, number>;

export type ThemeSummaryDto = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  targetLang: string;
  nativeLang: string;
  wordCount: number;
  counts: StatusCounts;
  createdAt: string;
  updatedAt: string;
};

// ── Pictures ────────────────────────────────────────────────────────────────

export type PictureDto = {
  id: string;
  provider: ImageProvider;
  /** Same-origin URLs served by the API. */
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  title: string | null;
  creator: string | null;
  creatorUrl: string | null;
  license: string | null;
  licenseUrl: string | null;
  sourceUrl: string | null;
};

/** A search hit shown in the picker (preview images load from the provider). */
export type PictureSearchResult = {
  provider: SearchProvider;
  id: string;
  previewUrl: string;
  width: number;
  height: number;
  title: string | null;
  creator: string | null;
  license: string | null;
};

export const pictureSearchSchema = z.object({
  q: z.string().trim().min(1).max(100),
  /** Ask one provider only (the picker shows each provider's results as they arrive). */
  provider: z.enum(SEARCH_PROVIDERS).optional(),
});

export const pictureChoiceSchema = z.object({
  provider: z.enum(SEARCH_PROVIDERS),
  id: z.string().min(1).max(100),
});

export const pictureVisibilitySchema = z.object({ hidden: z.boolean() });

/** A picture from any web address (an image, a search-engine result link or a page). */
export const pictureLinkSchema = z.object({
  url: z
    .url({ protocol: /^https?$/, error: 'Paste a web address starting with http(s)://' })
    .max(2048),
});

export type ThemeWordDto = {
  lexemeId: string;
  lemma: string;
  pos: PartOfSpeech;
  gender: Gender | null;
  aspect: Aspect | null;
  aspectPair: string | null;
  forms: Record<string, string> | null;
  pronunciation: string | null;
  translations: string[];
  examples: Array<{ id: string; text: string; translation: string | null; cloze: string | null }>;
  status: WordStatus;
  note: string | null;
  mnemonic: string | null;
  otherThemes: Array<{ id: string; name: string }>;
  /** Whether the shared dictionary fields can be edited by this user. */
  editable: boolean;
  /** The picture this user sees (personal choice, else the shared default). */
  image: PictureDto | null;
  imageHidden: boolean;
  imageQuery: string | null;
  /** An automatic picture search is queued or running. */
  imagePending: boolean;
};

export type ThemeDetailDto = ThemeSummaryDto & { words: ThemeWordDto[]; picturesPending: number };

export function emptyCounts(): StatusCounts {
  return { untagged: 0, unknown: 0, recognize: 0, known: 0 };
}

export const STATUS_LABELS: Record<WordStatus, string> = {
  untagged: 'Untagged',
  unknown: "Don't know",
  recognize: 'Recognize',
  known: 'Known',
};

export const POS_LABELS: Record<PartOfSpeech, string> = {
  noun: 'noun',
  verb: 'verb',
  adjective: 'adj.',
  adverb: 'adv.',
  pronoun: 'pron.',
  preposition: 'prep.',
  conjunction: 'conj.',
  numeral: 'num.',
  particle: 'particle',
  interjection: 'interj.',
  phrase: 'phrase',
};

export const GENDER_LABELS: Record<Gender, string> = {
  m: 'masculine',
  f: 'feminine',
  n: 'neuter',
  mp: 'virile pl.',
  nmp: 'non-virile pl.',
};

/** What AI can fill in for theme words that lack it: example sentences or grammatical forms. */
export const FILL_KINDS = ['examples', 'forms'] as const;
export type FillKind = (typeof FILL_KINDS)[number];

export const fillGenerateSchema = z.object({
  credentialId: z.string().min(1),
  model: z.string().trim().min(1).max(200).optional(),
});

export const fillImportSchema = z.object({
  raw: z.string().min(1).max(300_000),
  /** The prompt that produced `raw`, kept for the generation log. */
  prompt: z.string().max(100_000).optional(),
});

export type FillPromptDto = {
  prompt: string;
  promptVersion: string;
  /** Words the prompt asks about (at most one batch). */
  lemmas: string[];
};

export type FillResultDto = {
  /** Sentences or form sets saved. */
  added: number;
  /** Words that got something. */
  words: number;
  /** Theme words still missing it. */
  remaining: number;
  issues: ImportIssue[];
};
