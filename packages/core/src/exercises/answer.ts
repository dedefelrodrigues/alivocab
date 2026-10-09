/**
 * Typed-answer checking. Exact matches are correct; an answer that only lacks diacritics or has
 * one typo is accepted as "almost" (graded Hard, and the learner is shown what was off).
 */
import { foldDiacritics, normalizeKey } from '../text/normalize.ts';

export type AnswerVerdict =
  /** Exactly one of the accepted answers. */
  | 'correct'
  /** Right except for missing or wrong diacritics (`zolw` for `żółw`). */
  | 'accents'
  /** One letter off (a typo), for words of four letters or more. */
  | 'typo'
  | 'wrong';

export type AnswerCheck = {
  verdict: AnswerVerdict;
  /** The accepted answer closest to what was typed (shown as the correction). */
  expected: string;
};

/** Leading words that don't change the meaning of an English gloss ("to run", "a house"). */
const FILLER_PREFIXES: Record<string, RegExp> = {
  en: /^(to|a|an|the)\s+/,
};

/** Comparison key: normalized, lowercase, without punctuation and filler words. */
function comparable(text: string, lang: string): string {
  let key = normalizeKey(text, lang)
    .replace(/[.,!?;:"“”„«»¿¡()[\]]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const filler = FILLER_PREFIXES[lang];
  if (filler) key = key.replace(filler, '');
  return key;
}

/**
 * The answers to accept for one stored text: alternatives separated by `/`, `,` or `;`, with
 * parenthesized notes removed ("peel (fruit)" → "peel").
 */
export function acceptedAnswers(texts: string[]): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    const base = text
      .replace(/\([^)]*\)/gu, '')
      .replace(/\s+([,;/])/gu, '$1')
      .replace(/\s+/gu, ' ')
      .trim();
    for (const v of [base, ...base.split(/[/,;]/)]) {
      const clean = v.trim();
      if (clean) out.add(clean);
    }
  }
  return [...out];
}

/** Levenshtein distance, stopping early once it exceeds `max`. */
export function editDistance(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  const x = [...a];
  const y = [...b];
  if (Math.abs(x.length - y.length) > max) return max + 1;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      const value = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[y.length] ?? 0;
}

const RANK: Record<AnswerVerdict, number> = { correct: 0, accents: 1, typo: 2, wrong: 3 };

/** Checks a typed answer against the accepted ones (see `acceptedAnswers`). */
export function checkAnswer(given: string, accepted: string[], lang: string): AnswerCheck {
  const typed = comparable(given, lang);
  let best: AnswerCheck = { verdict: 'wrong', expected: accepted[0] ?? '' };
  if (!typed) return best;
  for (const answer of accepted) {
    const target = comparable(answer, lang);
    if (!target) continue;
    let verdict: AnswerVerdict = 'wrong';
    if (typed === target) verdict = 'correct';
    else if (foldDiacritics(typed) === foldDiacritics(target)) verdict = 'accents';
    else if ([...target].length >= 4 && editDistance(typed, target, 1) <= 1) verdict = 'typo';
    else if (
      [...target].length >= 4 &&
      editDistance(foldDiacritics(typed), foldDiacritics(target), 1) <= 1
    ) {
      verdict = 'typo';
    }
    if (RANK[verdict] < RANK[best.verdict]) best = { verdict, expected: answer };
    if (verdict === 'correct') break;
  }
  return best;
}

/**
 * Letters the learner may need to type that a usual keyboard lacks, offered as buttons under
 * answer fields.
 */
export const SPECIAL_LETTERS: Record<string, string> = {
  pl: 'ąćęłńóśźż',
  cs: 'áčďéěíňóřšťúůýž',
  sk: 'áäčďéíĺľňóôŕšťúýž',
  de: 'äöüß',
  fr: 'àâçéèêëîïôœùûü',
  es: 'áéíñóúü',
  pt: 'áâãàçéêíóôõú',
  it: 'àèéìòù',
  ro: 'ăâîșț',
  sv: 'åäö',
  nl: 'éëï',
};
