/**
 * Form drills: "kot → instrumental: Idę z ___" → "kotem". The forms come from the word's stored
 * grammatical forms (the keys the vocabulary prompt asks for, see FORM_GUIDE).
 */

/** Plain-English names for form keys, used in every language. */
export const FORM_LABELS: Record<string, string> = {
  gen_sg: 'genitive singular',
  nom_pl: 'nominative plural',
  ins_sg: 'instrumental singular',
  pl: 'plural',
  pres_1sg: 'present tense, I',
  pres_2sg: 'present tense, you (singular)',
  pres_3sg: 'present tense, he / she',
  pres_3pl: 'present tense, they',
  past_m: 'past tense, he',
  past_1sg: 'past tense, I',
  past_participle: 'past participle',
  praeteritum_3sg: 'simple past, he / she',
  perfekt: 'perfect tense',
  comparative: 'comparative',
  f: 'feminine',
  n: 'neuter',
  nom_pl_virile: 'plural, men / mixed group',
};

/** Sentence frames that call for a form (`___` is the gap), per language and form key. */
const FRAMES: Record<string, Record<string, { text: string; translation: string }>> = {
  pl: {
    gen_sg: { text: 'Nie ma ___.', translation: 'There is no …' },
    nom_pl: { text: 'To są ___.', translation: 'These are …' },
    ins_sg: { text: 'Idę z ___.', translation: 'I’m going with …' },
    pres_1sg: { text: 'Ja ___.', translation: 'I …' },
    pres_2sg: { text: 'Ty ___.', translation: 'You …' },
    pres_3pl: { text: 'Oni ___.', translation: 'They …' },
    past_m: { text: 'Wczoraj on ___.', translation: 'Yesterday he …' },
    f: { text: 'Ona jest ___.', translation: 'She is …' },
    n: { text: 'Dziecko jest ___.', translation: 'The child is …' },
    nom_pl_virile: { text: 'Oni są ___.', translation: 'They (men) are …' },
  },
};

export type Drill = {
  formKey: string;
  /** What to produce, e.g. "instrumental singular". */
  label: string;
  /** A sentence with the gap, when the language has one for this form. */
  frame: { before: string; after: string; translation: string } | null;
  answer: string;
};

/**
 * Picks a form to drill for a word, preferring forms that differ from the dictionary form
 * (nothing to practice in "plural of *wody* is *wody*" when it equals the lemma). Returns null
 * when the word has no usable forms.
 */
export function pickDrill(
  word: { lemma: string; lang: string; forms: Record<string, string> | null },
  rand: () => number = Math.random,
): Drill | null {
  const entries = Object.entries(word.forms ?? {}).filter(
    ([key, value]) => FORM_LABELS[key] && value.trim() && value.split(/\s+/).length <= 3,
  );
  if (!entries.length) return null;
  const lemma = word.lemma.toLocaleLowerCase(word.lang);
  const different = entries.filter(([, v]) => v.trim().toLocaleLowerCase(word.lang) !== lemma);
  const pool = different.length ? different : entries;
  const [formKey, value] = pool[Math.floor(rand() * pool.length)] as [string, string];
  const frame = FRAMES[word.lang]?.[formKey];
  const gap = frame?.text.indexOf('___') ?? -1;
  return {
    formKey,
    label: FORM_LABELS[formKey] as string,
    frame:
      frame && gap >= 0
        ? {
            before: frame.text.slice(0, gap),
            after: frame.text.slice(gap + 3),
            translation: frame.translation,
          }
        : null,
    answer: value.trim(),
  };
}
