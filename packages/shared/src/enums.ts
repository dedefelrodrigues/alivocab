/** Domain enums shared by DB schema, API validation and UI. */

export const WORD_STATUSES = ['untagged', 'unknown', 'recognize', 'known'] as const;
export type WordStatus = (typeof WORD_STATUSES)[number];

export const STATUS_SOURCES = ['manual', 'derived'] as const;
export type StatusSource = (typeof STATUS_SOURCES)[number];

export const CARD_DIRECTIONS = ['recognition', 'recall'] as const;
export type CardDirection = (typeof CARD_DIRECTIONS)[number];

export const PARTS_OF_SPEECH = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'preposition',
  'conjunction',
  'numeral',
  'particle',
  'interjection',
  'phrase',
] as const;
export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];

export const GENDERS = ['m', 'f', 'n', 'mp', 'nmp'] as const;
export type Gender = (typeof GENDERS)[number];

export const ASPECTS = ['impf', 'pf'] as const;
export type Aspect = (typeof ASPECTS)[number];

export const CONTENT_SOURCES = ['ai', 'user', 'import'] as const;
export type ContentSource = (typeof CONTENT_SOURCES)[number];

export const AI_PROVIDERS = [
  'anthropic',
  'openai',
  'deepseek',
  'google',
  'openrouter',
  'openai_compat',
] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Where a generation was produced. */
export const AI_SOURCES = ['api', 'browser', 'manual'] as const;
export type AiSource = (typeof AI_SOURCES)[number];

export const GENERATION_KINDS = [
  'vocab_proposal',
  'example_sentences',
  'listening_script',
  'grammar_note',
  'drill',
  'sentence_grade',
  'roleplay',
] as const;
export type GenerationKind = (typeof GENERATION_KINDS)[number];

export const EXERCISE_TYPES = [
  'flashcard',
  'mcq',
  'cloze',
  'listening',
  'drill',
  'sentence',
  'translation',
  'roleplay',
] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

export const EXPOSURE_CONTEXTS = [...EXERCISE_TYPES, 'proposal'] as const;
export type ExposureContext = (typeof EXPOSURE_CONTEXTS)[number];

export const LESSON_KINDS = ['listening', 'grammar', 'drill', 'sentence', 'roleplay'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const TTS_PROVIDERS = ['browser', 'openai', 'azure', 'elevenlabs'] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** `upload` and `link` are pictures a learner brought themselves; only they see them. */
export const IMAGE_PROVIDERS = ['wikimedia', 'openverse', 'pexels', 'upload', 'link'] as const;
/** Providers that can be searched (everything except the user's own uploads). */
export const SEARCH_PROVIDERS = ['wikimedia', 'openverse', 'pexels'] as const;
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];
