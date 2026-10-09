/**
 * Sentence building ("put the words in order") from stored example sentences, and a free check
 * for typed translations against the stored one.
 */
import { foldDiacritics, normalizeKey } from '../text/normalize.ts';
import { editDistance } from './answer.ts';
import { shuffle } from './choices.ts';

export type Scramble = {
  /** The words in a shuffled order (what the learner picks from). */
  tokens: string[];
  /** The words in the right order. */
  answer: string[];
  /** Punctuation that ends the sentence (shown fixed after the last word). */
  end: string;
};

const EDGE_PUNCT = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

/** Words of a sentence without surrounding punctuation ("Dzień," → "Dzień"). */
export function sentenceWords(sentence: string): string[] {
  return sentence
    .trim()
    .split(/\s+/u)
    .map((w) => w.replace(EDGE_PUNCT, ''))
    .filter(Boolean);
}

/**
 * Shuffles a sentence's words for a sentence-building exercise. Sentences of 3 to 10 words only
 * (shorter are trivial, longer are tedious on a phone).
 */
export function buildScramble(sentence: string, rand: () => number = Math.random): Scramble | null {
  const answer = sentenceWords(sentence);
  if (answer.length < 3 || answer.length > 10) return null;
  const end = /([.!?…]+)["”»]?\s*$/u.exec(sentence.trim())?.[1] ?? '';
  let tokens = shuffle(answer, rand);
  for (let i = 0; i < 5 && tokens.join(' ') === answer.join(' '); i++)
    tokens = shuffle(answer, rand);
  return { tokens, answer, end };
}

/** Whether the chosen words form the sentence (duplicate words may come in either order). */
export function scrambleCorrect(chosen: string[], answer: string[], lang: string): boolean {
  return normalizeKey(chosen.join(' '), lang) === normalizeKey(answer.join(' '), lang);
}

export type TranslationCheck =
  /** Same as the stored translation (ignoring case and punctuation). */
  | 'match'
  /** Same except for diacritics. */
  | 'accents'
  /** One word different, missing or extra. */
  | 'close'
  /** Different: may still be right (word order, synonyms), so offer an AI check. */
  | 'different';

/** Free check of a typed sentence against the stored translation. */
export function checkTranslation(given: string, reference: string, lang: string): TranslationCheck {
  const a = sentenceWords(normalizeKey(given, lang));
  const b = sentenceWords(normalizeKey(reference, lang));
  if (!a.length) return 'different';
  if (a.join(' ') === b.join(' ')) return 'match';
  if (foldDiacritics(a.join(' ')) === foldDiacritics(b.join(' '))) return 'accents';
  // Word-level edit distance: compare words as single symbols.
  const symbols = new Map<string, string>();
  const encode = (words: string[]) =>
    words
      .map((w) => {
        if (!symbols.has(w)) symbols.set(w, String.fromCodePoint(0x4e00 + symbols.size));
        return symbols.get(w);
      })
      .join('');
  return editDistance(encode(a), encode(b), 1) <= 1 ? 'close' : 'different';
}
