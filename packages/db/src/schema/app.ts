/**
 * Application tables (PLAN.md §3). Every user-owned table carries `user_id`; queries must
 * always filter on it.
 */
import {
  AI_PROVIDERS,
  AI_SOURCES,
  ASPECTS,
  CARD_DIRECTIONS,
  CONTENT_SOURCES,
  EXERCISE_TYPES,
  EXPOSURE_CONTEXTS,
  GENDERS,
  GENERATION_KINDS,
  IMAGE_PROVIDERS,
  LESSON_KINDS,
  LOG_LEVELS,
  PARTS_OF_SPEECH,
  STATUS_SOURCES,
  TTS_PROVIDERS,
  WORD_STATUSES,
} from '@alivocab/shared/enums';
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { user } from './auth.ts';
import { createdAt, id, timestamp, updatedAt } from './columns.ts';

const userId = () =>
  text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' });

// ── Accounts & settings ─────────────────────────────────────────────────────

export const inviteCodes = sqliteTable('invite_codes', {
  id: id(),
  code: text('code').notNull().unique(),
  note: text('note'),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  maxUses: integer('max_uses').notNull().default(1),
  uses: integer('uses').notNull().default(0),
  expiresAt: timestamp('expires_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: createdAt(),
});

export const userProfiles = sqliteTable('user_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  targetLang: text('target_lang').notNull().default('pl'),
  nativeLang: text('native_lang').notNull().default('en'),
  defaultWordCount: integer('default_word_count').notNull().default(30),
  /** `'api:<credentialId>' | 'browser' | 'manual'` */
  defaultAiSource: text('default_ai_source').notNull().default('manual'),
  ttsProvider: text('tts_provider', { enum: TTS_PROVIDERS }).notNull().default('browser'),
  ttsVoice: text('tts_voice'),
  dailyNewLimit: integer('daily_new_limit').notNull().default(20),
  dailyReviewLimit: integer('daily_review_limit').notNull().default(200),
  /** `'auto'` or a palette id from @alivocab/shared/appearance. */
  colorPalette: text('color_palette').notNull().default('auto'),
  colorMode: text('color_mode', { enum: ['system', 'light', 'dark'] })
    .notNull()
    .default('system'),
  /** Find a picture automatically for new words that can be pictured. */
  autoPictures: integer('auto_pictures', { mode: 'boolean' }).notNull().default(true),
  /** Record every request in the activity log and show the Log page. */
  advancedMode: integer('advanced_mode', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const aiCredentials = sqliteTable(
  'ai_credentials',
  {
    id: id(),
    userId: userId(),
    provider: text('provider', { enum: AI_PROVIDERS }).notNull(),
    label: text('label').notNull(),
    baseUrl: text('base_url'),
    defaultModel: text('default_model'),
    keyCiphertext: text('key_ciphertext').notNull(),
    keyIv: text('key_iv').notNull(),
    keyTag: text('key_tag').notNull(),
    keyLast4: text('key_last4').notNull(),
    lastTestedAt: timestamp('last_tested_at'),
    lastTestOk: integer('last_test_ok', { mode: 'boolean' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ai_credentials_user_idx').on(t.userId)],
);

// ── Shared dictionary ───────────────────────────────────────────────────────

export const lexemes = sqliteTable(
  'lexemes',
  {
    id: id(),
    lang: text('lang').notNull(),
    lemma: text('lemma').notNull(),
    normalizedLemma: text('normalized_lemma').notNull(),
    pos: text('pos', { enum: PARTS_OF_SPEECH }).notNull(),
    gender: text('gender', { enum: GENDERS }),
    aspect: text('aspect', { enum: ASPECTS }),
    aspectPairLemma: text('aspect_pair_lemma'),
    /** JSON object of grammatical forms, e.g. `{ "gen_sg": "chleba" }`. */
    forms: text('forms_json', { mode: 'json' }).$type<Record<string, string>>(),
    pronunciation: text('pronunciation'),
    frequencyRank: integer('frequency_rank'),
    /** English photo search phrase; '' = can't be pictured, null = unknown. */
    imageQuery: text('image_query'),
    /** Default picture shared by all learners (each can override or hide it). */
    imageId: text('image_id').references((): AnySQLiteColumn => lexemeImages.id, {
      onDelete: 'set null',
    }),
    /** Last automatic picture search, so it isn't retried on every save. */
    imageSearchedAt: timestamp('image_searched_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('lexemes_lang_lemma_pos_uq').on(t.lang, t.normalizedLemma, t.pos)],
);

/** Stored pictures (resized WebP files under MEDIA_DIR) with their attribution. */
export const lexemeImages = sqliteTable(
  'lexeme_images',
  {
    id: id(),
    lexemeId: text('lexeme_id')
      .notNull()
      .references((): AnySQLiteColumn => lexemes.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: IMAGE_PROVIDERS }).notNull(),
    providerId: text('provider_id'),
    /** File key: `<key>.webp` (≤400px) and `<key>-thumb.webp` (96px square). */
    fileKey: text('file_key').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    title: text('title'),
    creator: text('creator'),
    creatorUrl: text('creator_url'),
    license: text('license'),
    licenseUrl: text('license_url'),
    sourceUrl: text('source_url'),
    /** Uploads stay private to their owner. */
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('lexeme_images_lexeme_idx').on(t.lexemeId),
    uniqueIndex('lexeme_images_provider_uq').on(t.lexemeId, t.provider, t.providerId),
  ],
);

export const lexemeTranslations = sqliteTable(
  'lexeme_translations',
  {
    id: id(),
    lexemeId: text('lexeme_id')
      .notNull()
      .references(() => lexemes.id, { onDelete: 'cascade' }),
    lang: text('lang').notNull(),
    text: text('text').notNull(),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [uniqueIndex('lexeme_translations_uq').on(t.lexemeId, t.lang, t.text)],
);

export const exampleSentences = sqliteTable(
  'example_sentences',
  {
    id: id(),
    lexemeId: text('lexeme_id')
      .notNull()
      .references(() => lexemes.id, { onDelete: 'cascade' }),
    lang: text('lang').notNull(),
    text: text('text').notNull(),
    translation: text('translation'),
    translationLang: text('translation_lang'),
    /** The word form exactly as it appears in `text`, used for cloze exercises. */
    clozeTarget: text('cloze_target'),
    source: text('source', { enum: CONTENT_SOURCES }).notNull(),
    generationId: text('generation_id').references(() => aiGenerations.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [index('example_sentences_lexeme_idx').on(t.lexemeId)],
);

// ── Themes ──────────────────────────────────────────────────────────────────

export const themes = sqliteTable(
  'themes',
  {
    id: id(),
    userId: userId(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    targetLang: text('target_lang').notNull(),
    nativeLang: text('native_lang').notNull(),
    visibility: text('visibility', { enum: ['private'] })
      .notNull()
      .default('private'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('themes_user_slug_uq').on(t.userId, t.slug)],
);

export const themeLexemes = sqliteTable(
  'theme_lexemes',
  {
    themeId: text('theme_id')
      .notNull()
      .references(() => themes.id, { onDelete: 'cascade' }),
    lexemeId: text('lexeme_id')
      .notNull()
      .references(() => lexemes.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    addedAt: createdAt(),
    generationId: text('generation_id').references(() => aiGenerations.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    primaryKey({ columns: [t.themeId, t.lexemeId] }),
    index('theme_lexemes_lexeme_idx').on(t.lexemeId),
  ],
);

// ── Per-user learning state ─────────────────────────────────────────────────

export const userLexemes = sqliteTable(
  'user_lexemes',
  {
    userId: userId(),
    lexemeId: text('lexeme_id')
      .notNull()
      .references(() => lexemes.id, { onDelete: 'cascade' }),
    status: text('status', { enum: WORD_STATUSES }).notNull().default('untagged'),
    statusSource: text('status_source', { enum: STATUS_SOURCES }).notNull().default('manual'),
    note: text('note'),
    mnemonic: text('mnemonic'),
    exposureCount: integer('exposure_count').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    incorrectCount: integer('incorrect_count').notNull().default(0),
    firstSeenAt: timestamp('first_seen_at'),
    lastSeenAt: timestamp('last_seen_at'),
    /** Personal picture choice overriding the shared default. */
    imageId: text('image_id').references(() => lexemeImages.id, { onDelete: 'set null' }),
    imageHidden: integer('image_hidden', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.lexemeId] }),
    index('user_lexemes_user_status_idx').on(t.userId, t.status),
  ],
);

/** FSRS card state (field names follow ts-fsrs). */
export const cards = sqliteTable(
  'cards',
  {
    id: id(),
    userId: userId(),
    lexemeId: text('lexeme_id')
      .notNull()
      .references(() => lexemes.id, { onDelete: 'cascade' }),
    direction: text('direction', { enum: CARD_DIRECTIONS }).notNull(),
    due: timestamp('due').notNull(),
    stability: real('stability').notNull().default(0),
    difficulty: real('difficulty').notNull().default(0),
    elapsedDays: real('elapsed_days').notNull().default(0),
    scheduledDays: real('scheduled_days').notNull().default(0),
    learningSteps: integer('learning_steps').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    /** ts-fsrs State: 0 New, 1 Learning, 2 Review, 3 Relearning */
    state: integer('state').notNull().default(0),
    lastReview: timestamp('last_review'),
    suspended: integer('suspended', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    uniqueIndex('cards_user_lexeme_dir_uq').on(t.userId, t.lexemeId, t.direction),
    index('cards_user_due_idx').on(t.userId, t.due),
  ],
);

export const reviewLogs = sqliteTable(
  'review_logs',
  {
    id: id(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    userId: userId(),
    rating: integer('rating').notNull(),
    exerciseType: text('exercise_type', { enum: EXERCISE_TYPES }).notNull(),
    correct: integer('correct', { mode: 'boolean' }).notNull(),
    responseMs: integer('response_ms'),
    answerGiven: text('answer_given'),
    stateBefore: integer('state_before').notNull(),
    stabilityBefore: real('stability_before').notNull(),
    dueBefore: timestamp('due_before').notNull(),
    reviewedAt: createdAt(),
  },
  (t) => [index('review_logs_user_time_idx').on(t.userId, t.reviewedAt)],
);

export const exposures = sqliteTable(
  'exposures',
  {
    id: id(),
    userId: userId(),
    lexemeId: text('lexeme_id')
      .notNull()
      .references(() => lexemes.id, { onDelete: 'cascade' }),
    context: text('context', { enum: EXPOSURE_CONTEXTS }).notNull(),
    lessonId: text('lesson_id').references(() => lessons.id, { onDelete: 'set null' }),
    at: createdAt(),
  },
  (t) => [index('exposures_user_lexeme_idx').on(t.userId, t.lexemeId)],
);

// ── AI generations, lessons, audio ──────────────────────────────────────────

export const aiGenerations = sqliteTable(
  'ai_generations',
  {
    id: id(),
    userId: userId(),
    kind: text('kind', { enum: GENERATION_KINDS }).notNull(),
    source: text('source', { enum: AI_SOURCES }).notNull(),
    provider: text('provider'),
    model: text('model'),
    promptVersion: text('prompt_version').notNull(),
    prompt: text('prompt').notNull(),
    rawOutput: text('raw_output'),
    parsedOk: integer('parsed_ok', { mode: 'boolean' }).notNull().default(false),
    error: text('error'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    createdAt: createdAt(),
  },
  (t) => [index('ai_generations_user_idx').on(t.userId, t.createdAt)],
);

export const lessons = sqliteTable(
  'lessons',
  {
    id: id(),
    userId: userId(),
    themeId: text('theme_id').references(() => themes.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: LESSON_KINDS }).notNull(),
    title: text('title').notNull(),
    content: text('content_json', { mode: 'json' }).$type<unknown>().notNull(),
    generationId: text('generation_id').references(() => aiGenerations.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [index('lessons_user_theme_idx').on(t.userId, t.themeId)],
);

export const lessonLexemes = sqliteTable(
  'lesson_lexemes',
  {
    lessonId: text('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    lexemeId: text('lexeme_id')
      .notNull()
      .references(() => lexemes.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.lessonId, t.lexemeId] })],
);

export const ttsCache = sqliteTable('tts_cache', {
  hash: text('hash').primaryKey(),
  filePath: text('file_path').notNull(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: createdAt(),
});

/**
 * Activity log: API requests (all of them in advanced mode, otherwise only failures) and
 * problems reported by the web app. AI calls are read from `ai_generations`. Pruned after
 * `LOG_RETENTION_DAYS`.
 */
export const appLogs = sqliteTable(
  'app_logs',
  {
    id: id(),
    userId: userId(),
    level: text('level', { enum: LOG_LEVELS }).notNull(),
    category: text('category', { enum: ['request', 'app'] }).notNull(),
    message: text('message').notNull(),
    status: integer('status'),
    durationMs: integer('duration_ms'),
    details: text('details_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('app_logs_user_idx').on(t.userId, t.createdAt)],
);
