import {
  type ImportIssue,
  MAX_WORDS_PER_SAVE,
  type VocabExample,
  type VocabWord,
  wordSchema,
} from '@alivocab/shared';
import { normalizeKey, normalizeText } from '../text/normalize.ts';
import { extractRecords, type RawRecord, type SourceFormat } from './extract.ts';
import {
  fieldFor,
  genderHint,
  parseAspect,
  parseForms,
  parseGender,
  parsePos,
  splitList,
} from './fields.ts';

export type ParseOptions = { lang: string; nativeLang: string };

export type ParseResult = {
  format: SourceFormat | null;
  words: VocabWord[];
  issues: ImportIssue[];
};

/** Template placeholders a model copied verbatim (`<Polish word>`, `...`) count as empty. */
const PLACEHOLDER_RE = /^(?:<[^<>]*>|\.{2,}|…|-|n\/a|null|none|undefined)$/i;

const str = (v: unknown): string => {
  const text = typeof v === 'string' ? normalizeText(v) : typeof v === 'number' ? String(v) : '';
  return PLACEHOLDER_RE.test(text) ? '' : text;
};

/** Remaps arbitrary JSON keys onto our field names (`Polish` → lemma, `meaning` → translations…). */
function canonicalize(data: Record<string, unknown>, opts: ParseOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const field = fieldFor(key, opts.lang, opts.nativeLang) ?? key;
    if (out[field] === undefined) out[field] = value;
  }
  return out;
}

function cleanLemma(raw: string): { lemma: string; gender: ReturnType<typeof parseGender> } {
  let lemma = raw
    .replace(/^["'„“”«»]+|["'„“”«»]+$/g, '')
    .replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '')
    .trim();
  let gender: ReturnType<typeof parseGender> = null;
  const annotation = /\s*\(([^)]{1,15})\)\s*$/.exec(lemma);
  if (annotation?.[1]) {
    const g = parseGender(annotation[1]);
    if (g) {
      gender = g;
      lemma = lemma.slice(0, annotation.index).trim();
    }
  }
  return { lemma, gender };
}

function findCloze(
  text: string,
  candidate: string | null,
  lemma: string,
  lang: string,
): string | null {
  const lower = text.toLocaleLowerCase(lang);
  for (const c of [candidate, lemma]) {
    if (!c) continue;
    const i = lower.indexOf(c.toLocaleLowerCase(lang));
    if (i >= 0) return text.slice(i, i + c.length);
  }
  return null;
}

function toExamples(data: Record<string, unknown>, lemma: string, lang: string): VocabExample[] {
  const raw = data.examples;
  const fallbackTranslation = str(data.exampleTranslation) || null;
  const fallbackCloze = str(data.cloze) || null;
  const list: unknown[] = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];

  const examples: VocabExample[] = [];
  for (const item of list) {
    let text = '';
    let translation: string | null = null;
    let cloze: string | null = null;
    if (typeof item === 'string') {
      text = normalizeText(item);
      translation = fallbackTranslation;
      cloze = fallbackCloze;
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      text = str(o.text ?? o.sentence ?? o.example ?? o[lang] ?? o.target);
      translation = str(o.translation ?? o.meaning ?? o.native) || null;
      cloze = str(o.cloze ?? o.form ?? o.word) || null;
    }
    if (!text || text.length > 400) continue;
    examples.push({
      text,
      translation: translation && translation.length <= 400 ? translation : null,
      cloze: findCloze(text, cloze, lemma, lang),
    });
    if (examples.length === 5) break;
  }
  return examples;
}

function normalizeRecord(
  { row, data: rawData }: RawRecord,
  opts: ParseOptions,
  issues: ImportIssue[],
): VocabWord | null {
  const data = canonicalize(rawData, opts);
  const { lemma, gender: lemmaGender } = cleanLemma(str(data.lemma));
  if (!lemma) {
    issues.push({ row, severity: 'error', message: 'Missing word (lemma); row skipped' });
    return null;
  }
  if (lemma.split(/\s+/).length > 6) {
    issues.push({
      row,
      lemma: lemma.slice(0, 40),
      severity: 'error',
      message: 'Too long to be a word or phrase; row skipped',
    });
    return null;
  }

  const translationsRaw = data.translations;
  const translations = [
    ...new Set(
      (Array.isArray(translationsRaw)
        ? translationsRaw.map(str)
        : splitList(str(translationsRaw))
      ).filter((t) => t && t.length <= 200),
    ),
  ].slice(0, 10);
  if (!translations.length) {
    issues.push({ row, lemma, severity: 'error', message: 'Missing translation; row skipped' });
    return null;
  }

  const posText = str(data.pos);
  let pos = posText ? parsePos(posText) : null;
  if (!pos) {
    pos = lemma.includes(' ') ? 'phrase' : 'noun';
    issues.push({
      row,
      lemma,
      severity: 'warning',
      message: posText
        ? `Unknown part of speech "${posText}"; assumed ${pos}`
        : `Part of speech missing; assumed ${pos}`,
    });
  }

  const genderText = str(data.gender);
  let gender = genderText ? parseGender(genderText) : null;
  gender ??= lemmaGender ?? (posText ? genderHint(posText) : null);
  if (genderText && !parseGender(genderText) && pos === 'noun') {
    issues.push({
      row,
      lemma,
      severity: 'warning',
      message: `Unknown gender "${genderText}" ignored`,
    });
  }
  if (pos !== 'noun') gender = null;

  const aspectText = str(data.aspect);
  const aspect = pos === 'verb' && aspectText ? parseAspect(aspectText) : null;
  const aspectPair = pos === 'verb' ? str(data.aspectPair) || null : null;

  const word = {
    lemma,
    pos,
    gender,
    aspect,
    aspectPair: aspectPair && aspectPair !== lemma ? aspectPair : null,
    translations,
    forms: parseForms(data.forms),
    pronunciation: str(data.pronunciation).replace(/^[/[]|[/\]]$/g, '') || null,
    examples: toExamples(data, lemma, opts.lang),
    notes: str(data.notes) || null,
    // Present but empty means "can't be pictured"; absent means unknown.
    imageQuery: 'imageQuery' in data ? str(data.imageQuery).slice(0, 100) : null,
  };

  const checked = wordSchema.safeParse(word);
  if (!checked.success) {
    const first = checked.error.issues[0];
    issues.push({
      row,
      lemma,
      severity: 'error',
      message: `Invalid ${first?.path.join('.') || 'value'}: ${first?.message ?? 'unknown error'}; row skipped`,
    });
    return null;
  }
  return checked.data;
}

/** Merges a duplicate into the first occurrence (union of translations and examples). */
function merge(into: VocabWord, from: VocabWord): void {
  into.translations = [...new Set([...into.translations, ...from.translations])].slice(0, 10);
  const texts = new Set(into.examples.map((e) => e.text));
  for (const e of from.examples)
    if (!texts.has(e.text) && into.examples.length < 5) into.examples.push(e);
  into.gender ??= from.gender;
  into.aspect ??= from.aspect;
  into.aspectPair ??= from.aspectPair;
  into.forms ??= from.forms;
  into.pronunciation ??= from.pronunciation;
  into.notes ??= from.notes;
  into.imageQuery ??= from.imageQuery;
}

export function dedupeKey(word: Pick<VocabWord, 'lemma' | 'pos'>, lang: string): string {
  return `${normalizeKey(word.lemma, lang)}|${word.pos}`;
}

/**
 * Parses AI output or pasted lists into validated, normalized, de-duplicated words.
 * Never throws: problems are reported per row in `issues`.
 */
export function parseVocabulary(raw: string, opts: ParseOptions): ParseResult {
  const { format, records, issues } = extractRecords(raw, opts);
  const words: VocabWord[] = [];
  const seen = new Map<string, { word: VocabWord; row: number }>();

  for (const record of records) {
    const word = normalizeRecord(record, opts, issues);
    if (!word) continue;
    const key = dedupeKey(word, opts.lang);
    const first = seen.get(key);
    if (first) {
      merge(first.word, word);
      issues.push({
        row: record.row,
        lemma: word.lemma,
        severity: 'warning',
        message: `Duplicate of row ${first.row}; merged`,
      });
      continue;
    }
    if (words.length >= MAX_WORDS_PER_SAVE) {
      issues.push({
        row: record.row,
        severity: 'error',
        message: `Only the first ${MAX_WORDS_PER_SAVE} words can be imported at once`,
      });
      break;
    }
    seen.set(key, { word, row: record.row });
    words.push(word);
  }

  return { format, words, issues };
}
