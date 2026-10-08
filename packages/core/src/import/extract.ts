/**
 * Turns raw pasted text (chat answers, spreadsheets, notes) into loose records. Supported:
 * JSON (objects, arrays, NDJSON, broken JSON via jsonrepair, inside or outside ``` fences),
 * CSV/TSV (header or positional), Markdown tables, and simple "word – translation" lists.
 */

import type { ImportIssue } from '@alivocab/shared';
import { jsonrepair } from 'jsonrepair';
import Papa from 'papaparse';
import { type Field, fieldFor } from './fields.ts';

export type RawRecord = { row: number; data: Record<string, unknown> };
export type SourceFormat = 'json' | 'csv' | 'table' | 'list';
export type Extracted = {
  format: SourceFormat | null;
  records: RawRecord[];
  issues: ImportIssue[];
};

type Ctx = { lang: string; nativeLang: string };

const FENCE_RE = /```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g;

/**
 * Joins the raw answers of several generation batches. The extractor splits on it again and
 * reads each answer on its own, so one batch's formatting can't break another's.
 */
export const BATCH_SEPARATOR = '\n\n----- next batch -----\n\n';
const BATCH_SPLIT_RE = /\n-{3,} next batch -{3,}\n/;

/** Removes ``` fence lines (used when fences are nested or unbalanced). */
function stripFences(text: string): string {
  return text.replace(/^[ \t]*```.*$/gm, '');
}

function codeBlocks(text: string): string[] {
  return [...text.matchAll(FENCE_RE)].map((m) => m[2] ?? '').filter((b) => b.trim());
}

// ── JSON ────────────────────────────────────────────────────────────────────

function parseJsonLoose(text: string): unknown {
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error('no JSON');
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return JSON.parse(jsonrepair(slice));
  }
}

const LIST_KEYS = ['words', 'vocabulary', 'vocab', 'items', 'entries', 'data', 'list', 'results'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Finds the list of word objects inside any reasonable JSON shape. */
function itemsFromJson(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    // A list of word lists (e.g. merged batches) is flattened.
    if (value.every(Array.isArray)) return value.flat().filter(isPlainObject);
    if (
      value.length &&
      value.every((v) => isPlainObject(v) && LIST_KEYS.some((k) => Array.isArray(v[k])))
    ) {
      return value.flatMap(itemsFromJson);
    }
    return value.filter(isPlainObject);
  }
  if (!isPlainObject(value)) return [];
  for (const key of LIST_KEYS) {
    if (Array.isArray(value[key])) return itemsFromJson(value[key]);
  }
  const arrays = Object.values(value).filter(
    (v): v is unknown[] => Array.isArray(v) && v.some(isPlainObject),
  );
  if (arrays.length) return arrays.flatMap(itemsFromJson);
  // { "chleb": "bread", "masło": "butter" }
  const entries = Object.entries(value);
  if (entries.length && entries.every(([, v]) => typeof v === 'string')) {
    return entries.map(([lemma, translation]) => ({ lemma, translation }));
  }
  // A single word object.
  return [value];
}

function tryJson(blocks: string[]): Record<string, unknown>[] | null {
  const items: Record<string, unknown>[] = [];
  let parsedAny = false;
  for (const block of blocks) {
    if (!/[[{]/.test(block)) continue;
    try {
      items.push(...itemsFromJson(parseJsonLoose(block)));
      parsedAny = true;
    } catch {
      // Not JSON (or beyond repair); other formats are tried next.
    }
  }
  return parsedAny && items.length ? items : null;
}

// ── Delimited text ──────────────────────────────────────────────────────────

/** Default column order when a CSV has no header (matches the prompt's CSV header). */
const POSITIONAL: Field[] = [
  'lemma',
  'translations',
  'pos',
  'gender',
  'aspect',
  'aspectPair',
  'forms',
  'pronunciation',
  'examples',
  'exampleTranslation',
  'cloze',
  'notes',
  'imageQuery',
];

function rowsToRecords(rows: string[][], ctx: Ctx, issues: ImportIssue[]): RawRecord[] {
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim()));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0] ?? [];
  const mapped = header.map((h) => fieldFor(h, ctx.lang, ctx.nativeLang));
  const hasHeader = mapped.filter(Boolean).length >= 2 && mapped.includes('lemma');

  let fields: (Field | null)[];
  let body: string[][];
  if (hasHeader) {
    fields = mapped;
    body = nonEmpty.slice(1);
  } else {
    fields = POSITIONAL;
    body = nonEmpty;
    if ((header.length ?? 0) > 2) {
      issues.push({
        row: null,
        severity: 'warning',
        message: 'No header row found; assumed the column order lemma;translation;pos;gender;…',
      });
    }
  }

  return body.map((cells, i) => {
    const data: Record<string, unknown> = {};
    cells.forEach((cell, c) => {
      const field = fields[c];
      if (field && cell.trim() && data[field] === undefined) data[field] = cell.trim();
    });
    return { row: i + 1, data };
  });
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

function tryMarkdownTable(text: string, ctx: Ctx, issues: ImportIssue[]): RawRecord[] | null {
  const lines = text.split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length < 2 || !lines.some(isTableSeparator)) return null;
  const rows = lines
    .filter((l) => !isTableSeparator(l))
    .map((l) =>
      l
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim().replace(/^\*\*(.*)\*\*$/, '$1')),
    );
  return rowsToRecords(rows, ctx, issues);
}

function tryCsv(text: string, ctx: Ctx, issues: ImportIssue[]): RawRecord[] | null {
  const result = Papa.parse<string[]>(text.trim(), {
    skipEmptyLines: 'greedy',
    delimitersToGuess: [';', '\t', ','],
  });
  const rows = result.data.filter(Array.isArray);
  if (!rows.length) return null;
  const multi = rows.filter((r) => r.filter((c) => c.trim()).length >= 2).length;
  if (multi / rows.length < 0.6) return null;
  // A single comma-separated line is far more likely prose than a one-row CSV.
  if (rows.length === 1 && result.meta.delimiter === ',') return null;
  return rowsToRecords(rows, ctx, issues);
}

const LIST_LINE_RE =
  /^\s*(?:\d+[.)]\s*|[-*•]\s+)?(.+?)(?:\s+(?:[–—=]|-{1,2}|->|→)|\s*:)\s+(.+?)\s*$/;

function tryList(text: string): RawRecord[] | null {
  const records: RawRecord[] = [];
  let row = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    row++;
    const m = LIST_LINE_RE.exec(line.replace(/\*\*/g, ''));
    if (m?.[1] && m[2]) records.push({ row, data: { lemma: m[1], translations: m[2] } });
  }
  return records.length ? records : null;
}

// ── Entry point ─────────────────────────────────────────────────────────────

type SegmentResult = { format: SourceFormat; records: RawRecord[] } | null;

function extractSegment(text: string, ctx: Ctx, issues: ImportIssue[]): SegmentResult {
  const blocks = codeBlocks(text);
  const json =
    tryJson(blocks.length ? blocks : [text]) ??
    // Nested or unbalanced fences (e.g. a ```json block inside another fence).
    (blocks.length ? tryJson([stripFences(text)]) : null);
  if (json) return { format: 'json', records: json.map((data, i) => ({ row: i + 1, data })) };

  for (const body of blocks.length ? [blocks.join('\n'), stripFences(text)] : [text]) {
    const table = tryMarkdownTable(body, ctx, issues);
    if (table?.length) return { format: 'table', records: table };
    const csv = tryCsv(body, ctx, issues);
    if (csv?.length) return { format: 'csv', records: csv };
    const list = tryList(body);
    if (list) return { format: 'list', records: list };
  }
  return null;
}

export function extractRecords(raw: string, ctx: Ctx): Extracted {
  const issues: ImportIssue[] = [];
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    // Reasoning models (Qwen3, DeepSeek-R1…) may prepend their chain of thought.
    .replace(/<think>[\s\S]*?<\/think>/g, '');

  const records: RawRecord[] = [];
  let format: SourceFormat | null = null;
  for (const segment of text.split(BATCH_SPLIT_RE)) {
    if (!segment.trim()) continue;
    const found = extractSegment(segment, ctx, issues);
    if (!found) continue;
    format ??= found.format;
    // Keep row numbers unique across batches.
    const offset = records.length;
    records.push(...found.records.map((r) => ({ row: r.row + offset, data: r.data })));
  }

  if (!records.length) {
    issues.push({
      row: null,
      severity: 'error',
      message:
        'Could not find any words. Paste the JSON or CSV answer from the AI, a Markdown table, or lines like "chleb – bread".',
    });
  }
  return { format, records, issues };
}
