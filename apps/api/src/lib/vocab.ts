/**
 * Shared-dictionary writes and reads: dedupe-aware saving of words, proposal enrichment and
 * theme queries. All functions are synchronous (better-sqlite3) and scoped to one user.
 */
import { dedupeKey, normalizeKey } from '@alivocab/core';
import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import {
  type ContentSource,
  emptyCounts,
  type ProposalWord,
  type StatusCounts,
  type TaggedWord,
  type ThemeSummaryDto,
  type ThemeWordDto,
  type VocabWord,
  type WordStatus,
} from '@alivocab/shared';
import { and, asc, eq, inArray, max, ne, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';

const {
  lexemes,
  lexemeTranslations,
  exampleSentences,
  themes,
  themeLexemes,
  userLexemes,
  exposures,
} = schema;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type ThemeRow = typeof themes.$inferSelect;

const MAX_EXAMPLES_PER_LEXEME = 5;

// ── Themes ──────────────────────────────────────────────────────────────────

export function findOwnedTheme(db: Db | Tx, userId: string, themeId: string): ThemeRow {
  const theme = db
    .select()
    .from(themes)
    .where(and(eq(themes.id, themeId), eq(themes.userId, userId)))
    .get();
  if (!theme) throw new HTTPException(404, { message: 'Theme not found' });
  return theme;
}

export function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/\p{Mn}/gu, '')
      .replace(/[łŁ]/g, 'l')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'theme'
  );
}

export function uniqueSlug(db: Db | Tx, userId: string, name: string, exceptId?: string): string {
  const base = slugify(name);
  const taken = new Set(
    db
      .select({ slug: themes.slug, id: themes.id })
      .from(themes)
      .where(eq(themes.userId, userId))
      .all()
      .filter((t) => t.id !== exceptId)
      .map((t) => t.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function themeLemmas(db: Db, themeId: string): string[] {
  return db
    .select({ lemma: lexemes.lemma })
    .from(themeLexemes)
    .innerJoin(lexemes, eq(lexemes.id, themeLexemes.lexemeId))
    .where(eq(themeLexemes.themeId, themeId))
    .all()
    .map((r) => r.lemma);
}

function countsByTheme(db: Db, userId: string, themeIds: string[]): Map<string, StatusCounts> {
  const out = new Map(themeIds.map((id) => [id, emptyCounts()]));
  if (!themeIds.length) return out;
  const rows = db
    .select({
      themeId: themeLexemes.themeId,
      status: sql<WordStatus>`coalesce(${userLexemes.status}, 'untagged')`,
      n: sql<number>`count(*)`,
    })
    .from(themeLexemes)
    .leftJoin(
      userLexemes,
      and(eq(userLexemes.lexemeId, themeLexemes.lexemeId), eq(userLexemes.userId, userId)),
    )
    .where(inArray(themeLexemes.themeId, themeIds))
    .groupBy(themeLexemes.themeId, sql`2`)
    .all();
  for (const r of rows) {
    const counts = out.get(r.themeId);
    if (counts) counts[r.status] = r.n;
  }
  return out;
}

function toSummary(theme: ThemeRow, counts: StatusCounts): ThemeSummaryDto {
  return {
    id: theme.id,
    name: theme.name,
    slug: theme.slug,
    description: theme.description,
    targetLang: theme.targetLang,
    nativeLang: theme.nativeLang,
    wordCount: Object.values(counts).reduce((a, b) => a + b, 0),
    counts,
    createdAt: theme.createdAt.toISOString(),
    updatedAt: theme.updatedAt.toISOString(),
  };
}

export function listThemes(db: Db, userId: string): ThemeSummaryDto[] {
  const rows = db
    .select()
    .from(themes)
    .where(eq(themes.userId, userId))
    .orderBy(sql`${themes.updatedAt} desc`)
    .all();
  const counts = countsByTheme(
    db,
    userId,
    rows.map((t) => t.id),
  );
  return rows.map((t) => toSummary(t, counts.get(t.id) ?? emptyCounts()));
}

export function themeSummary(db: Db, userId: string, theme: ThemeRow): ThemeSummaryDto {
  return toSummary(theme, countsByTheme(db, userId, [theme.id]).get(theme.id) ?? emptyCounts());
}

/** Other users who have this lexeme in their dictionary (shared data is then read-only). */
export function isSharedWithOthers(db: Db, userId: string, lexemeId: string): boolean {
  return !!db
    .select({ id: userLexemes.lexemeId })
    .from(userLexemes)
    .where(and(eq(userLexemes.lexemeId, lexemeId), ne(userLexemes.userId, userId)))
    .get();
}

export function themeWords(
  db: Db,
  userId: string,
  theme: ThemeRow,
  isAdmin: boolean,
): ThemeWordDto[] {
  const rows = db
    .select({ lexeme: lexemes, userLexeme: userLexemes })
    .from(themeLexemes)
    .innerJoin(lexemes, eq(lexemes.id, themeLexemes.lexemeId))
    .leftJoin(
      userLexemes,
      and(eq(userLexemes.lexemeId, lexemes.id), eq(userLexemes.userId, userId)),
    )
    .where(eq(themeLexemes.themeId, theme.id))
    .orderBy(asc(themeLexemes.position), asc(themeLexemes.addedAt))
    .all();
  const ids = rows.map((r) => r.lexeme.id);
  if (!ids.length) return [];

  const translations = new Map<string, string[]>();
  for (const t of db
    .select()
    .from(lexemeTranslations)
    .where(
      and(inArray(lexemeTranslations.lexemeId, ids), eq(lexemeTranslations.lang, theme.nativeLang)),
    )
    .orderBy(asc(lexemeTranslations.sort))
    .all()) {
    translations.set(t.lexemeId, [...(translations.get(t.lexemeId) ?? []), t.text]);
  }

  const examples = new Map<string, ThemeWordDto['examples']>();
  for (const e of db
    .select()
    .from(exampleSentences)
    .where(inArray(exampleSentences.lexemeId, ids))
    .orderBy(asc(exampleSentences.createdAt))
    .all()) {
    if (e.translationLang && e.translationLang !== theme.nativeLang) continue;
    examples.set(e.lexemeId, [
      ...(examples.get(e.lexemeId) ?? []),
      { id: e.id, text: e.text, translation: e.translation, cloze: e.clozeTarget },
    ]);
  }

  const otherThemes = new Map<string, Array<{ id: string; name: string }>>();
  for (const r of db
    .select({ lexemeId: themeLexemes.lexemeId, id: themes.id, name: themes.name })
    .from(themeLexemes)
    .innerJoin(themes, eq(themes.id, themeLexemes.themeId))
    .where(
      and(inArray(themeLexemes.lexemeId, ids), eq(themes.userId, userId), ne(themes.id, theme.id)),
    )
    .all()) {
    otherThemes.set(r.lexemeId, [
      ...(otherThemes.get(r.lexemeId) ?? []),
      { id: r.id, name: r.name },
    ]);
  }

  const shared = new Set(
    db
      .select({ lexemeId: userLexemes.lexemeId })
      .from(userLexemes)
      .where(and(inArray(userLexemes.lexemeId, ids), ne(userLexemes.userId, userId)))
      .all()
      .map((r) => r.lexemeId),
  );

  return rows.map(({ lexeme: l, userLexeme: u }) => ({
    lexemeId: l.id,
    lemma: l.lemma,
    pos: l.pos,
    gender: l.gender,
    aspect: l.aspect,
    aspectPair: l.aspectPairLemma,
    forms: l.forms ?? null,
    pronunciation: l.pronunciation,
    translations: translations.get(l.id) ?? [],
    examples: examples.get(l.id) ?? [],
    status: u?.status ?? 'untagged',
    note: u?.note ?? null,
    mnemonic: u?.mnemonic ?? null,
    otherThemes: otherThemes.get(l.id) ?? [],
    editable: isAdmin || !shared.has(l.id),
  }));
}

// ── Proposals ───────────────────────────────────────────────────────────────

function findLexeme(db: Db | Tx, lang: string, word: Pick<VocabWord, 'lemma' | 'pos'>) {
  return db
    .select()
    .from(lexemes)
    .where(
      and(
        eq(lexemes.lang, lang),
        eq(lexemes.normalizedLemma, normalizeKey(word.lemma, lang)),
        eq(lexemes.pos, word.pos),
      ),
    )
    .get();
}

/** Marks proposed words the user already has (with status and themes). */
export function enrichProposal(
  db: Db,
  userId: string,
  lang: string,
  words: VocabWord[],
  themeId?: string,
): ProposalWord[] {
  return words.map((word) => {
    const key = dedupeKey(word, lang);
    const lexeme = findLexeme(db, lang, word);
    if (!lexeme) return { ...word, key, existing: null, inTheme: false };

    const own = db
      .select({ status: userLexemes.status })
      .from(userLexemes)
      .where(and(eq(userLexemes.userId, userId), eq(userLexemes.lexemeId, lexeme.id)))
      .get();
    const inThemes = db
      .select({ id: themes.id, name: themes.name })
      .from(themeLexemes)
      .innerJoin(themes, eq(themes.id, themeLexemes.themeId))
      .where(and(eq(themeLexemes.lexemeId, lexeme.id), eq(themes.userId, userId)))
      .all();

    return {
      ...word,
      key,
      existing: own ? { lexemeId: lexeme.id, status: own.status, themes: inThemes } : null,
      inTheme: !!themeId && inThemes.some((t) => t.id === themeId),
    };
  });
}

// ── Saving ──────────────────────────────────────────────────────────────────

export type SaveOptions = {
  userId: string;
  themeId: string;
  lang: string;
  nativeLang: string;
  words: TaggedWord[];
  source: ContentSource;
  generationId?: string | null;
};

/**
 * Upserts words into the shared dictionary (filling gaps, never overwriting others' data),
 * links them to the theme and records the user's tag. Runs in one transaction.
 */
export function saveWords(db: Db, opts: SaveOptions): { added: number; linked: number } {
  const now = new Date();
  let added = 0;
  let linked = 0;

  db.transaction((tx) => {
    const start =
      (tx
        .select({ p: max(themeLexemes.position) })
        .from(themeLexemes)
        .where(eq(themeLexemes.themeId, opts.themeId))
        .get()?.p ?? -1) + 1;

    opts.words.forEach((word, i) => {
      const status = word.status ?? 'untagged';
      let lexeme = findLexeme(tx, opts.lang, word);
      if (!lexeme) {
        lexeme = tx
          .insert(lexemes)
          .values({
            lang: opts.lang,
            lemma: word.lemma,
            normalizedLemma: normalizeKey(word.lemma, opts.lang),
            pos: word.pos,
            gender: word.gender ?? null,
            aspect: word.aspect ?? null,
            aspectPairLemma: word.aspectPair ?? null,
            forms: word.forms ?? null,
            pronunciation: word.pronunciation ?? null,
          })
          .returning()
          .get();
      } else {
        // Fill only missing shared fields.
        const fill = {
          ...(lexeme.gender === null && word.gender ? { gender: word.gender } : {}),
          ...(lexeme.aspect === null && word.aspect ? { aspect: word.aspect } : {}),
          ...(lexeme.aspectPairLemma === null && word.aspectPair
            ? { aspectPairLemma: word.aspectPair }
            : {}),
          ...(lexeme.forms === null && word.forms ? { forms: word.forms } : {}),
          ...(lexeme.pronunciation === null && word.pronunciation
            ? { pronunciation: word.pronunciation }
            : {}),
        };
        if (Object.keys(fill).length) {
          tx.update(lexemes).set(fill).where(eq(lexemes.id, lexeme.id)).run();
        }
      }
      const lexemeId = lexeme.id;

      word.translations.forEach((text, sort) => {
        tx.insert(lexemeTranslations)
          .values({ lexemeId, lang: opts.nativeLang, text, sort })
          .onConflictDoNothing()
          .run();
      });

      const existingExamples = tx
        .select({ text: exampleSentences.text })
        .from(exampleSentences)
        .where(eq(exampleSentences.lexemeId, lexemeId))
        .all()
        .map((e) => e.text);
      let room = MAX_EXAMPLES_PER_LEXEME - existingExamples.length;
      for (const ex of word.examples ?? []) {
        if (room <= 0) break;
        if (existingExamples.includes(ex.text)) continue;
        tx.insert(exampleSentences)
          .values({
            lexemeId,
            lang: opts.lang,
            text: ex.text,
            translation: ex.translation ?? null,
            translationLang: ex.translation ? opts.nativeLang : null,
            clozeTarget: ex.cloze ?? null,
            source: opts.source,
            generationId: opts.generationId ?? null,
          })
          .run();
        room--;
      }

      const link = tx
        .insert(themeLexemes)
        .values({
          themeId: opts.themeId,
          lexemeId,
          position: start + i,
          generationId: opts.generationId ?? null,
        })
        .onConflictDoNothing()
        .run();
      if (link.changes) linked++;

      const own = tx
        .select()
        .from(userLexemes)
        .where(and(eq(userLexemes.userId, opts.userId), eq(userLexemes.lexemeId, lexemeId)))
        .get();
      if (!own) {
        tx.insert(userLexemes)
          .values({
            userId: opts.userId,
            lexemeId,
            status,
            statusSource: 'manual',
            note: word.notes ?? null,
            exposureCount: 1,
            firstSeenAt: now,
            lastSeenAt: now,
          })
          .run();
        tx.insert(exposures).values({ userId: opts.userId, lexemeId, context: 'proposal' }).run();
        added++;
      } else if (status !== 'untagged' && status !== own.status) {
        tx.update(userLexemes)
          .set({ status, statusSource: 'manual' })
          .where(and(eq(userLexemes.userId, opts.userId), eq(userLexemes.lexemeId, lexemeId)))
          .run();
      }
    });

    tx.update(themes).set({ updatedAt: now }).where(eq(themes.id, opts.themeId)).run();
  });

  return { added, linked };
}
