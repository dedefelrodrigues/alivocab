/**
 * Field-level normalizers for messy AI / spreadsheet output: header aliases, part-of-speech and
 * gender synonyms (English + Polish + Romance terms), list splitting and grammatical forms.
 */
import type { Aspect, Gender, PartOfSpeech } from '@alivocab/shared';
import { languageName } from '@alivocab/shared';

export type Field =
  | 'lemma'
  | 'translations'
  | 'pos'
  | 'gender'
  | 'aspect'
  | 'aspectPair'
  | 'forms'
  | 'pronunciation'
  | 'examples'
  | 'exampleTranslation'
  | 'cloze'
  | 'notes'
  | 'imageQuery';

/** Canonical key form: lowercase ASCII-ish letters/digits only. */
export function keyOf(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/ł/g, 'l')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const FIELD_ALIASES: Record<Field, string[]> = {
  lemma: [
    'lemma',
    'word',
    'term',
    'headword',
    'target',
    'targetword',
    'slowo',
    'palavra',
    'palabra',
    'mot',
    'wort',
    'vocab',
    'vocabulary',
  ],
  translations: [
    'translation',
    'translations',
    'meaning',
    'meanings',
    'definition',
    'gloss',
    'native',
    'traducao',
    'traduccion',
    'tlumaczenie',
  ],
  pos: ['pos', 'partofspeech', 'wordclass', 'type', 'class', 'category', 'czescmowy'],
  gender: ['gender', 'genus', 'rodzaj', 'genero'],
  aspect: ['aspect', 'aspekt', 'verbaspect'],
  aspectPair: ['aspectpair', 'aspectpartner', 'pair', 'paired', 'counterpart', 'parapektowa'],
  forms: ['forms', 'inflections', 'inflection', 'grammar', 'declension', 'conjugation', 'odmiana'],
  pronunciation: ['pronunciation', 'ipa', 'phonetic', 'phonetics', 'wymowa'],
  examples: [
    'examples',
    'example',
    'examplesentence',
    'sentence',
    'sentences',
    'przyklad',
    'exemplo',
    'ejemplo',
  ],
  exampleTranslation: [
    'exampletranslation',
    'sentencetranslation',
    'translationofexample',
    'exampleen',
    'examplemeaning',
  ],
  cloze: ['cloze', 'clozetarget', 'forminsentence', 'clozeword'],
  notes: ['notes', 'note', 'tip', 'tips', 'comment', 'comments', 'usage', 'remarks', 'uwagi'],
  imageQuery: [
    'imagequery',
    'image',
    'picture',
    'photo',
    'photoquery',
    'imagesearch',
    'picturequery',
    'imagesearchquery',
  ],
};

/** Maps a column header or JSON key to a field, using language names as extra aliases. */
export function fieldFor(name: string, lang: string, nativeLang: string): Field | null {
  const k = keyOf(name);
  if (!k) return null;
  if (k === keyOf(languageName(lang)) || k === lang) return 'lemma';
  if (k === keyOf(languageName(nativeLang)) || k === nativeLang) return 'translations';
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [Field, string[]][]) {
    if (aliases.includes(k)) return field;
  }
  return null;
}

const POS_SYNONYMS: Record<PartOfSpeech, string[]> = {
  noun: [
    'noun',
    'nouns',
    'n',
    'nn',
    'subst',
    'substantive',
    'substantivo',
    'sustantivo',
    'nom',
    'nomen',
    'rzeczownik',
    'rzecz',
    's',
  ],
  verb: ['verb', 'verbs', 'v', 'vb', 'verbo', 'verbe', 'czasownik', 'czas'],
  adjective: ['adjective', 'adj', 'a', 'adjetivo', 'adjectif', 'przymiotnik', 'przym'],
  adverb: ['adverb', 'adv', 'adverbio', 'adverbe', 'przyslowek', 'przysl'],
  pronoun: ['pronoun', 'pron', 'pronome', 'pronombre', 'zaimek'],
  preposition: ['preposition', 'prep', 'preposicao', 'preposicion', 'przyimek'],
  conjunction: ['conjunction', 'conj', 'conjuncao', 'conjuncion', 'spojnik'],
  numeral: ['numeral', 'num', 'number', 'liczebnik'],
  particle: ['particle', 'part', 'partykula'],
  interjection: ['interjection', 'interj', 'exclamation', 'wykrzyknik'],
  phrase: [
    'phrase',
    'phr',
    'expression',
    'expr',
    'idiom',
    'collocation',
    'fixedphrase',
    'nounphrase',
    'verbphrase',
    'wyrazenie',
    'zwrot',
    'frase',
    'expressao',
    'expresion',
  ],
};

const POS_LOOKUP = new Map<string, PartOfSpeech>(
  (Object.entries(POS_SYNONYMS) as [PartOfSpeech, string[]][]).flatMap(([pos, syns]) =>
    syns.map((s) => [s, pos] as const),
  ),
);

const GENDER_SYNONYMS: Record<Gender, string[]> = {
  m: [
    'm',
    'masc',
    'masculine',
    'male',
    'meski',
    'm1',
    'm2',
    'm3',
    'mos',
    'mzw',
    'mrz',
    'mask',
    'masculino',
    'masculin',
    'maskulinum',
  ],
  f: [
    'f',
    'fem',
    'feminine',
    'female',
    'zenski',
    'z',
    'feminino',
    'femenino',
    'feminin',
    'femininum',
  ],
  n: ['n', 'neut', 'neuter', 'nijaki', 'neutro', 'neutrum'],
  mp: ['mp', 'virile', 'meskoosobowy', 'pluralvirile', 'mplural', 'mpl'],
  nmp: ['nmp', 'nonvirile', 'niemeskoosobowy', 'pluralnonvirile', 'pl', 'plural'],
};

const GENDER_LOOKUP = new Map<string, Gender>(
  (Object.entries(GENDER_SYNONYMS) as [Gender, string[]][]).flatMap(([g, syns]) =>
    syns.map((s) => [s, g] as const),
  ),
);

const ASPECT_LOOKUP = new Map<string, Aspect>([
  ...['impf', 'imperfective', 'ipf', 'imp', 'ndk', 'niedokonany', 'imperf'].map(
    (s) => [s, 'impf'] as const,
  ),
  ...['pf', 'perf', 'perfective', 'dk', 'dokonany', 'perfectivo'].map((s) => [s, 'pf'] as const),
]);

export function parsePos(value: string): PartOfSpeech | null {
  const k = keyOf(value);
  if (!k) return null;
  const direct = POS_LOOKUP.get(k);
  if (direct) return direct;
  // "noun (m)", "noun, masculine", "verb – perfective": use the first word.
  const first = keyOf(value.split(/[\s,;()/–-]+/)[0] ?? '');
  return POS_LOOKUP.get(first) ?? null;
}

export function parseGender(value: string): Gender | null {
  const k = keyOf(value);
  if (!k) return null;
  return GENDER_LOOKUP.get(k) ?? null;
}

/** Finds a gender mentioned inside another field, e.g. pos "noun, masculine" or "noun (f)". */
export function genderHint(value: string): Gender | null {
  for (const token of value.split(/[\s,;()/.]+/)) {
    if (token.length === 0) continue;
    const g = parseGender(token);
    // Single letters only count inside an explicit annotation like "(m)".
    if (g && (token.length > 1 || /\(\s*[mfn]\s*\)/i.test(value))) return g;
  }
  return null;
}

export function parseAspect(value: string): Aspect | null {
  const k = keyOf(value);
  if (!k) return null;
  return (
    ASPECT_LOOKUP.get(k) ?? ASPECT_LOOKUP.get(keyOf(value.split(/[\s,;()]+/)[0] ?? '')) ?? null
  );
}

/** Splits "a | b", "a; b" or (if neither) "a, b" while keeping commas inside parentheses. */
export function splitList(value: string): string[] {
  const separator = /[|;]/.test(value) ? /[|;]/ : null;
  let parts: string[];
  if (separator) {
    parts = value.split(separator);
  } else {
    parts = [];
    let depth = 0;
    let current = '';
    for (const ch of value) {
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    parts.push(current);
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Parses forms from an object or a "key=value|key: value" string. */
export function parseForms(value: unknown): Record<string, string> | null {
  const out: Record<string, string> = {};
  const add = (k: string, v: unknown) => {
    const key = k
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[^\p{L}\p{N}_]/gu, '')
      .slice(0, 30);
    const val = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
    if (key && val && val.length <= 80) out[key] = val;
  };

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) add(k, v);
  } else if (typeof value === 'string') {
    for (const pair of value.split(/[|;,]/)) {
      const m = /^\s*([^=:]+?)\s*[=:]\s*(.+?)\s*$/.exec(pair);
      if (m?.[1] && m[2]) add(m[1], m[2]);
    }
  }
  return Object.keys(out).length ? out : null;
}
