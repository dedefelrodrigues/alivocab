/**
 * Materials: AI-written listening scripts and grammar notes for a theme, stored in `lessons`
 * with the theme words they use in `lesson_lexemes` (so reading or listening counts as exposure).
 */
import {
  buildGrammarPrompt,
  buildListeningPrompt,
  GRAMMAR_PROMPT_VERSION,
  LISTENING_PROMPT_VERSION,
  type MaterialParse,
  type MaterialWord,
  normalizeKey,
  parseGrammarNote,
  parseListeningScript,
} from '@alivocab/core';
import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import {
  type ExposureContext,
  type GrammarNote,
  grammarOptionsSchema,
  type ListeningScript,
  listeningOptionsSchema,
  type MaterialDto,
  type MaterialKind,
  type MaterialSummaryDto,
} from '@alivocab/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';

const {
  exposures,
  lessonLexemes,
  lessons,
  lexemes,
  lexemeTranslations,
  themeLexemes,
  themes,
  userLexemes,
} = schema;

type ThemeRow = typeof themes.$inferSelect;
type LessonRow = typeof lessons.$inferSelect;

export const MATERIAL_PROMPT_VERSION: Record<MaterialKind, string> = {
  listening: LISTENING_PROMPT_VERSION,
  grammar: GRAMMAR_PROMPT_VERSION,
};
export const MATERIAL_GENERATION_KIND = {
  listening: 'listening_script',
  grammar: 'grammar_note',
} as const;

/** Words offered to the AI per material. */
const WORDS_PER_KIND: Record<MaterialKind, number> = { listening: 15, grammar: 25 };

type ThemeWord = MaterialWord & { id: string };

/** Theme words for a material: the ones still being learned first. */
export function materialWords(db: Db, userId: string, theme: ThemeRow, kind: MaterialKind) {
  const rows = db
    .select({
      id: lexemes.id,
      lemma: lexemes.lemma,
      pos: lexemes.pos,
      forms: lexemes.forms,
      status: userLexemes.status,
    })
    .from(themeLexemes)
    .innerJoin(lexemes, eq(lexemes.id, themeLexemes.lexemeId))
    .leftJoin(
      userLexemes,
      and(eq(userLexemes.lexemeId, lexemes.id), eq(userLexemes.userId, userId)),
    )
    .where(eq(themeLexemes.themeId, theme.id))
    .orderBy(
      sql`case ${userLexemes.status} when 'unknown' then 0 when 'recognize' then 1 when 'untagged' then 2 else 3 end`,
      asc(themeLexemes.position),
    )
    .all();
  const ids = rows.map((r) => r.id);
  const translation = new Map<string, string>();
  if (ids.length) {
    for (const t of db
      .select()
      .from(lexemeTranslations)
      .where(
        and(
          inArray(lexemeTranslations.lexemeId, ids),
          eq(lexemeTranslations.lang, theme.nativeLang),
        ),
      )
      .orderBy(asc(lexemeTranslations.sort))
      .all()) {
      if (!translation.has(t.lexemeId)) translation.set(t.lexemeId, t.text);
    }
  }
  const all: ThemeWord[] = rows.map((r) => ({
    id: r.id,
    lemma: r.lemma,
    pos: r.pos,
    forms: r.forms,
    translation: translation.get(r.id) ?? null,
  }));
  return { all, offered: all.slice(0, WORDS_PER_KIND[kind]) };
}

/** Builds the prompt; options are validated against the kind's schema (400 if invalid). */
export function materialPrompt(
  kind: MaterialKind,
  theme: ThemeRow,
  words: readonly MaterialWord[],
  rawOptions: Record<string, unknown>,
): string {
  const base = {
    targetLang: theme.targetLang,
    nativeLang: theme.nativeLang,
    themeName: theme.name,
    words,
  };
  if (kind === 'listening') {
    const options = listeningOptionsSchema.safeParse(rawOptions);
    if (!options.success) throw new HTTPException(400, { message: 'Invalid listening options' });
    return buildListeningPrompt({ ...base, options: options.data });
  }
  const options = grammarOptionsSchema.safeParse(rawOptions);
  if (!options.success) throw new HTTPException(400, { message: 'Invalid grammar options' });
  return buildGrammarPrompt({ ...base, options: options.data });
}

export function parseMaterial(
  kind: MaterialKind,
  raw: string,
): MaterialParse<ListeningScript | GrammarNote> {
  return kind === 'listening' ? parseListeningScript(raw) : parseGrammarNote(raw);
}

/** All target-language text of a material (where theme words are looked for). */
function targetText(kind: MaterialKind, content: ListeningScript | GrammarNote): string {
  if (kind === 'listening') return (content as ListeningScript).lines.map((l) => l.text).join('\n');
  const note = content as GrammarNote;
  return note.sections
    .flatMap((s) => [...s.examples.map((e) => e.text), ...(s.table?.rows.flat() ?? [])])
    .join('\n');
}

const LETTER = /[\p{L}\p{M}]/u;

/** Whether `text` contains `word` as a whole word (case-insensitive). */
function containsWord(text: string, word: string, lang: string): boolean {
  const needle = normalizeKey(word, lang);
  if (!needle) return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) return false;
    const before = text[at - 1];
    const after = text[at + needle.length];
    if ((!before || !LETTER.test(before)) && (!after || !LETTER.test(after))) return true;
    from = at + 1;
  }
}

/** Theme words that appear in the material, as the lemma or one of its stored forms. */
export function wordsUsed(
  theme: ThemeRow,
  kind: MaterialKind,
  content: ListeningScript | GrammarNote,
  words: ThemeWord[],
): string[] {
  const text = normalizeKey(targetText(kind, content), theme.targetLang);
  return words
    .filter((w) =>
      [w.lemma, ...Object.values(w.forms ?? {})].some((form) =>
        containsWord(text, form, theme.targetLang),
      ),
    )
    .map((w) => w.id);
}

export function saveMaterial(
  db: Db,
  userId: string,
  theme: ThemeRow,
  kind: MaterialKind,
  content: ListeningScript | GrammarNote,
  generationId: string | null,
): MaterialDto {
  const { all } = materialWords(db, userId, theme, kind);
  const used = wordsUsed(theme, kind, content, all);
  const row = db.transaction((tx) => {
    const lesson = tx
      .insert(lessons)
      .values({ userId, themeId: theme.id, kind, title: content.title, content, generationId })
      .returning()
      .get();
    if (used.length) {
      tx.insert(lessonLexemes)
        .values(used.map((lexemeId) => ({ lessonId: lesson.id, lexemeId })))
        .run();
    }
    return lesson;
  });
  return materialDto(db, row);
}

export function findOwnedMaterial(db: Db, userId: string, id: string): LessonRow {
  const row = db
    .select()
    .from(lessons)
    .where(and(eq(lessons.id, id), eq(lessons.userId, userId)))
    .get();
  if (!row || (row.kind !== 'listening' && row.kind !== 'grammar')) {
    throw new HTTPException(404, { message: 'Material not found' });
  }
  return row;
}

export function listMaterials(db: Db, userId: string, themeId: string): MaterialSummaryDto[] {
  return db
    .select({
      id: lessons.id,
      kind: lessons.kind,
      title: lessons.title,
      createdAt: lessons.createdAt,
      wordCount: sql<number>`(select count(*) from ${lessonLexemes} where ${lessonLexemes.lessonId} = ${lessons.id})`,
    })
    .from(lessons)
    .where(
      and(
        eq(lessons.userId, userId),
        eq(lessons.themeId, themeId),
        inArray(lessons.kind, ['listening', 'grammar']),
      ),
    )
    .orderBy(desc(lessons.createdAt))
    .all()
    .map((r) => ({
      id: r.id,
      kind: r.kind as MaterialKind,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
      wordCount: r.wordCount,
    }));
}

export function materialDto(db: Db, row: LessonRow): MaterialDto {
  const theme = row.themeId
    ? db.select().from(themes).where(eq(themes.id, row.themeId)).get()
    : undefined;
  const nativeLang = theme?.nativeLang ?? 'en';
  const words = db
    .select({ id: lexemes.id, lemma: lexemes.lemma, lang: lexemes.lang })
    .from(lessonLexemes)
    .innerJoin(lexemes, eq(lexemes.id, lessonLexemes.lexemeId))
    .where(eq(lessonLexemes.lessonId, row.id))
    .orderBy(asc(lexemes.lemma))
    .all();
  const translations = new Map<string, string[]>();
  if (words.length) {
    for (const t of db
      .select()
      .from(lexemeTranslations)
      .where(
        and(
          inArray(
            lexemeTranslations.lexemeId,
            words.map((w) => w.id),
          ),
          eq(lexemeTranslations.lang, nativeLang),
        ),
      )
      .orderBy(asc(lexemeTranslations.sort))
      .all()) {
      translations.set(t.lexemeId, [...(translations.get(t.lexemeId) ?? []), t.text]);
    }
  }
  const base = {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    wordCount: words.length,
    themeId: row.themeId,
    lang: theme?.targetLang ?? words[0]?.lang ?? 'pl',
    nativeLang,
    words: words.map((w) => ({
      lexemeId: w.id,
      lemma: w.lemma,
      translations: translations.get(w.id) ?? [],
    })),
  };
  return row.kind === 'listening'
    ? { ...base, kind: 'listening', content: row.content as ListeningScript }
    : { ...base, kind: 'grammar', content: row.content as GrammarNote };
}

/** Counts the material's words as seen (listening or reading), once per call. */
export function recordMaterialSeen(db: Db, userId: string, row: LessonRow, now = new Date()) {
  const ids = db
    .select({ id: lessonLexemes.lexemeId })
    .from(lessonLexemes)
    .innerJoin(
      userLexemes,
      and(eq(userLexemes.lexemeId, lessonLexemes.lexemeId), eq(userLexemes.userId, userId)),
    )
    .where(eq(lessonLexemes.lessonId, row.id))
    .all()
    .map((r) => r.id);
  if (!ids.length) return 0;
  const context: ExposureContext = row.kind === 'listening' ? 'listening' : 'drill';
  db.transaction((tx) => {
    tx.insert(exposures)
      .values(ids.map((lexemeId) => ({ userId, lexemeId, context, lessonId: row.id, at: now })))
      .run();
    tx.update(userLexemes)
      .set({ exposureCount: sql`${userLexemes.exposureCount} + 1`, lastSeenAt: now })
      .where(and(eq(userLexemes.userId, userId), inArray(userLexemes.lexemeId, ids)))
      .run();
  });
  return ids.length;
}
