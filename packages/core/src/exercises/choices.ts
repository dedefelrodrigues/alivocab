/**
 * Multiple-choice distractors and cloze (fill-in) sentences. Pure and deterministic given `rand`.
 */
import { normalizeKey } from '../text/normalize.ts';

export type ChoiceCandidate = {
  id: string;
  lemma: string;
  pos: string;
  gender: string | null;
  translations: string[];
  hasImage: boolean;
  /** Shares a theme with the target word (better, more confusable distractors). */
  sameTheme: boolean;
};

/** What the options show: the target-language word, its meaning, or its picture. */
export type ChoiceMode = 'lemma' | 'meaning' | 'image';

/**
 * Picks plausible wrong options: same theme, part of speech and gender first, then anything
 * else. Never an option that would also be a correct answer (same word or same meaning) and
 * never two options that look the same.
 */
export function pickDistractors(
  target: ChoiceCandidate,
  pool: ChoiceCandidate[],
  {
    count = 3,
    mode,
    lang,
    nativeLang,
    rand = Math.random,
  }: {
    count?: number;
    mode: ChoiceMode;
    lang: string;
    nativeLang: string;
    rand?: () => number;
  },
): ChoiceCandidate[] {
  const lemmaKey = (c: ChoiceCandidate) => normalizeKey(c.lemma, lang);
  const meaningKeys = (c: ChoiceCandidate) =>
    c.translations.map((t) => normalizeKey(t, nativeLang));
  const shown = (c: ChoiceCandidate) =>
    mode === 'meaning' ? (meaningKeys(c)[0] ?? '') : mode === 'lemma' ? lemmaKey(c) : c.id;

  const targetMeanings = new Set(meaningKeys(target));
  const seen = new Set([shown(target)]);
  const scored = pool
    .filter(
      (c) =>
        c.id !== target.id &&
        lemmaKey(c) !== lemmaKey(target) &&
        !meaningKeys(c).some((m) => targetMeanings.has(m)) &&
        (mode !== 'image' || c.hasImage) &&
        (mode !== 'meaning' || c.translations.length > 0),
    )
    .map((c) => ({
      c,
      score:
        (c.sameTheme ? 4 : 0) +
        (c.pos === target.pos ? 2 : 0) +
        (target.gender && c.gender === target.gender ? 1 : 0) +
        // Some randomness so the same distractors don't always come back.
        rand() * 2.5,
    }))
    .sort((a, b) => b.score - a.score);

  const out: ChoiceCandidate[] = [];
  for (const { c } of scored) {
    const key = shown(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length === count) break;
  }
  return out;
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(items: readonly T[], rand = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export type Cloze = { before: string; answer: string; after: string };

const LETTER = /[\p{L}\p{M}]/u;

/**
 * Blanks out `target` (the word form as used in the sentence) as a whole word, case-insensitive.
 * Returns null when it isn't in the sentence.
 */
export function buildCloze(sentence: string, target: string | null, lang: string): Cloze | null {
  if (!target?.trim()) return null;
  const hay = sentence.toLocaleLowerCase(lang);
  const needle = target.trim().toLocaleLowerCase(lang);
  let from = 0;
  while (from <= hay.length) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return null;
    const end = at + needle.length;
    const before = sentence[at - 1];
    const after = sentence[end];
    if ((!before || !LETTER.test(before)) && (!after || !LETTER.test(after))) {
      return {
        before: sentence.slice(0, at),
        answer: sentence.slice(at, end),
        after: sentence.slice(end),
      };
    }
    from = at + 1;
  }
  return null;
}
