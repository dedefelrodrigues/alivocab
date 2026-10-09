/**
 * Example sentences on demand: finds theme words without a usable sentence (one whose cloze form
 * is in the text) and saves AI-written ones. Sentences are shared dictionary data, so only words
 * lacking them get new ones.
 */
import { buildCloze, buildExamplesPrompt, normalizeKey, parseVocabulary } from '@alivocab/core';
import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import type { ExamplesResultDto, ImportIssue } from '@alivocab/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';

const { exampleSentences, lexemes, lexemeTranslations, themeLexemes, themes } = schema;

type ThemeRow = typeof themes.$inferSelect;

/** Words per AI call (two sentences each). */
export const EXAMPLES_BATCH = 20;
const PER_WORD = 2;

export type ExampleTarget = { id: string; lemma: string; pos: string; translation: string | null };

/** Theme words without a sentence that a fill-in exercise could use, in theme order. */
export function wordsNeedingExamples(db: Db, theme: ThemeRow): ExampleTarget[] {
  const words = db
    .select({ id: lexemes.id, lemma: lexemes.lemma, pos: lexemes.pos })
    .from(themeLexemes)
    .innerJoin(lexemes, eq(lexemes.id, themeLexemes.lexemeId))
    .where(eq(themeLexemes.themeId, theme.id))
    .orderBy(asc(themeLexemes.position))
    .all();
  if (!words.length) return [];
  const ids = words.map((w) => w.id);
  const usable = new Set(
    db
      .select()
      .from(exampleSentences)
      .where(inArray(exampleSentences.lexemeId, ids))
      .all()
      .filter((e) => buildCloze(e.text, e.clozeTarget, theme.targetLang))
      .map((e) => e.lexemeId),
  );
  const translation = new Map<string, string>();
  for (const t of db
    .select()
    .from(lexemeTranslations)
    .where(
      and(inArray(lexemeTranslations.lexemeId, ids), eq(lexemeTranslations.lang, theme.nativeLang)),
    )
    .orderBy(asc(lexemeTranslations.sort))
    .all()) {
    if (!translation.has(t.lexemeId)) translation.set(t.lexemeId, t.text);
  }
  return words
    .filter((w) => !usable.has(w.id))
    .map((w) => ({ ...w, translation: translation.get(w.id) ?? null }));
}

export function examplesPrompt(theme: ThemeRow, targets: ExampleTarget[]): string {
  return buildExamplesPrompt({
    targetLang: theme.targetLang,
    nativeLang: theme.nativeLang,
    themeName: theme.name,
    words: targets,
    perWord: PER_WORD,
  });
}

/**
 * Parses an AI answer (any of the formats the vocabulary import reads) and saves sentences for
 * the theme words that need them. Sentences whose cloze form isn't in the text are skipped.
 */
export function saveExamples(
  db: Db,
  theme: ThemeRow,
  raw: string,
  generationId: string | null,
): ExamplesResultDto {
  const targets = wordsNeedingExamples(db, theme);
  const byKey = new Map(targets.map((t) => [normalizeKey(t.lemma, theme.targetLang), t]));
  const { words, issues } = parseVocabulary(raw, {
    lang: theme.targetLang,
    nativeLang: theme.nativeLang,
  });
  const extra: ImportIssue[] = [];
  let added = 0;
  const updated = new Set<string>();
  db.transaction((tx) => {
    for (const word of words) {
      const target = byKey.get(normalizeKey(word.lemma, theme.targetLang));
      if (!target) {
        extra.push({
          row: null,
          lemma: word.lemma,
          severity: 'warning',
          message: 'Not a word in this theme that needs sentences; skipped',
        });
        continue;
      }
      for (const ex of word.examples) {
        // A few sentences per word are plenty (the AI may send more than asked).
        const already = tx
          .select({ id: exampleSentences.id })
          .from(exampleSentences)
          .where(eq(exampleSentences.lexemeId, target.id))
          .all().length;
        if (already >= PER_WORD + 1) break;
        if (!buildCloze(ex.text, ex.cloze, theme.targetLang)) {
          extra.push({
            row: null,
            lemma: word.lemma,
            severity: 'warning',
            message: `“${ex.text}” doesn’t contain the word form to blank out; skipped`,
          });
          continue;
        }
        tx.insert(exampleSentences)
          .values({
            lexemeId: target.id,
            lang: theme.targetLang,
            text: ex.text,
            translation: ex.translation,
            translationLang: ex.translation ? theme.nativeLang : null,
            clozeTarget: ex.cloze,
            source: 'ai',
            generationId,
          })
          .run();
        added++;
        updated.add(target.id);
      }
    }
  });
  return {
    added,
    words: updated.size,
    remaining: wordsNeedingExamples(db, theme).length,
    issues: [...issues.filter((i) => i.severity === 'error'), ...extra].slice(0, 50),
  };
}
