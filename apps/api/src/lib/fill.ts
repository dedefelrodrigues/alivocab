/**
 * Filling in missing word data with AI, on demand: example sentences (fill-in exercises need one
 * whose cloze form is in the text) and grammatical forms (drills need them). Both are shared
 * dictionary data, so only words lacking them are touched, and answers go through the
 * vocabulary parser like every other AI output.
 */
import {
  buildCloze,
  buildExamplesPrompt,
  buildFormsPrompt,
  EXAMPLES_PROMPT_VERSION,
  FORMS_PROMPT_VERSION,
  normalizeKey,
  parseVocabulary,
} from '@alivocab/core';
import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import type { FillKind, FillResultDto, ImportIssue } from '@alivocab/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

const { exampleSentences, lexemes, lexemeTranslations, themeLexemes, themes } = schema;

type ThemeRow = typeof themes.$inferSelect;

/** Words per AI call. */
export const FILL_BATCH: Record<FillKind, number> = { examples: 20, forms: 30 };
const SENTENCES_PER_WORD = 2;
/** Parts of speech that inflect (worth asking forms for). */
const INFLECTING = new Set(['noun', 'verb', 'adjective', 'pronoun', 'numeral']);

export const FILL_PROMPT_VERSION: Record<FillKind, string> = {
  examples: EXAMPLES_PROMPT_VERSION,
  forms: FORMS_PROMPT_VERSION,
};
export const FILL_GENERATION_KIND = { examples: 'example_sentences', forms: 'drill' } as const;

export type FillTarget = { id: string; lemma: string; pos: string; translation: string | null };

/** Theme words still missing this kind of data, in theme order. */
export function wordsNeeding(db: Db, theme: ThemeRow, kind: FillKind): FillTarget[] {
  const words = db
    .select({ id: lexemes.id, lemma: lexemes.lemma, pos: lexemes.pos, forms: lexemes.forms })
    .from(themeLexemes)
    .innerJoin(lexemes, eq(lexemes.id, themeLexemes.lexemeId))
    .where(eq(themeLexemes.themeId, theme.id))
    .orderBy(asc(themeLexemes.position))
    .all();
  if (!words.length) return [];
  const ids = words.map((w) => w.id);

  let missing: typeof words;
  if (kind === 'forms') {
    missing = words.filter((w) => INFLECTING.has(w.pos) && !w.forms);
  } else {
    const usable = new Set(
      db
        .select()
        .from(exampleSentences)
        .where(inArray(exampleSentences.lexemeId, ids))
        .all()
        .filter((e) => buildCloze(e.text, e.clozeTarget, theme.targetLang))
        .map((e) => e.lexemeId),
    );
    missing = words.filter((w) => !usable.has(w.id));
  }

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
  return missing.map((w) => ({
    id: w.id,
    lemma: w.lemma,
    pos: w.pos,
    translation: translation.get(w.id) ?? null,
  }));
}

export function fillPrompt(theme: ThemeRow, kind: FillKind, targets: FillTarget[]): string {
  const input = { targetLang: theme.targetLang, nativeLang: theme.nativeLang, words: targets };
  return kind === 'forms'
    ? buildFormsPrompt(input)
    : buildExamplesPrompt({ ...input, themeName: theme.name, perWord: SENTENCES_PER_WORD });
}

/**
 * Parses an AI answer (any format the vocabulary import reads) and saves what the theme's words
 * are missing. Words not in the theme, sentences without the blanked form and empty form lists
 * are skipped with a warning.
 */
export function saveFill(
  db: Db,
  theme: ThemeRow,
  kind: FillKind,
  raw: string,
  generationId: string | null,
): FillResultDto {
  const targets = wordsNeeding(db, theme, kind);
  const byKey = new Map(targets.map((t) => [normalizeKey(t.lemma, theme.targetLang), t]));
  const { words, issues } = parseVocabulary(raw, {
    lang: theme.targetLang,
    nativeLang: theme.nativeLang,
  });
  const extra: ImportIssue[] = [];
  const warn = (lemma: string, message: string) =>
    extra.push({ row: null, lemma, severity: 'warning', message });
  let added = 0;
  const updated = new Set<string>();

  db.transaction((tx) => {
    for (const word of words) {
      const target = byKey.get(normalizeKey(word.lemma, theme.targetLang));
      if (!target) {
        warn(word.lemma, 'Not a word in this theme that needs this; skipped');
        continue;
      }
      if (kind === 'forms') {
        if (!word.forms || !Object.keys(word.forms).length || updated.has(target.id)) continue;
        // Only fill: never overwrite forms another learner's import already set.
        const done = tx
          .update(lexemes)
          .set({ forms: word.forms })
          .where(and(eq(lexemes.id, target.id), isNull(lexemes.forms)))
          .run();
        if (done.changes) {
          added++;
          updated.add(target.id);
        }
        continue;
      }
      for (const ex of word.examples) {
        // A few sentences per word are plenty (the AI may send more than asked).
        const count = tx
          .select({ id: exampleSentences.id })
          .from(exampleSentences)
          .where(eq(exampleSentences.lexemeId, target.id))
          .all().length;
        if (count >= SENTENCES_PER_WORD + 1) break;
        if (!buildCloze(ex.text, ex.cloze, theme.targetLang)) {
          warn(word.lemma, `“${ex.text}” doesn’t contain the word form to blank out; skipped`);
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
    remaining: wordsNeeding(db, theme, kind).length,
    issues: [...issues.filter((i) => i.severity === 'error'), ...extra].slice(0, 50),
  };
}
