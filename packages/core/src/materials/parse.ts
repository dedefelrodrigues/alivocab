/**
 * Parsers for AI-written materials. They accept the JSON wherever it is in the answer, repair
 * common slips (speaker names instead of ids, 1-based or lettered answers) and validate with the
 * shared schemas. They never throw.
 */
import {
  type GrammarNote,
  grammarNoteSchema,
  type ListeningScript,
  listeningScriptSchema,
} from '@alivocab/shared';
import { extractJsonValue } from '../import/extract.ts';

export type MaterialParse<T> = { ok: true; content: T } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Unwraps `{ "script": {...} }`-style wrappers. */
function unwrap(value: unknown, keys: string[]): unknown {
  if (!isObject(value)) return value;
  for (const key of keys) if (isObject(value[key])) return value[key];
  return value;
}

function firstIssue(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.') || 'answer'}: ${issue.message}` : 'invalid answer';
}

function answerIndex(answer: unknown, options: unknown[]): unknown {
  if (typeof answer === 'number') {
    // Some models count from 1.
    return answer >= options.length && answer - 1 < options.length ? answer - 1 : answer;
  }
  if (typeof answer === 'string') {
    const trimmed = answer.trim();
    if (/^[A-Ea-e]$/.test(trimmed)) return trimmed.toUpperCase().charCodeAt(0) - 65;
    if (/^\d+$/.test(trimmed)) return answerIndex(Number(trimmed), options);
    const at = options.findIndex((o) => String(o).trim().toLowerCase() === trimmed.toLowerCase());
    if (at >= 0) return at;
  }
  return answer;
}

export function parseListeningScript(raw: string): MaterialParse<ListeningScript> {
  const value = unwrap(extractJsonValue(raw), ['script', 'listening', 'dialogue', 'story']);
  if (!isObject(value)) return { ok: false, error: 'No JSON found in the answer' };
  const lines = Array.isArray(value.lines) ? value.lines.filter(isObject) : [];

  // Speakers: accept a missing list or lines that use names instead of ids.
  const speakers = (Array.isArray(value.speakers) ? value.speakers : []).map((s, i) =>
    isObject(s)
      ? { id: String(s.id ?? s.name ?? i + 1), name: String(s.name ?? s.id ?? `Speaker ${i + 1}`) }
      : { id: String(s), name: String(s) },
  );
  const known = new Map<string, string>();
  for (const s of speakers) {
    known.set(s.id.toLowerCase(), s.id);
    known.set(s.name.toLowerCase(), s.id);
  }
  const fixedLines = lines.map((l) => {
    const said = String(l.speaker ?? l.name ?? speakers[0]?.id ?? 'A');
    let id = known.get(said.toLowerCase());
    if (!id) {
      id = said;
      speakers.push({ id, name: said });
      known.set(said.toLowerCase(), id);
    }
    return { speaker: id, text: l.text ?? l.line, translation: l.translation ?? null };
  });

  const questions = (Array.isArray(value.questions) ? value.questions : [])
    .filter(isObject)
    .map((q) => {
      const options = Array.isArray(q.options) ? q.options : [];
      return { question: q.question, options, answer: answerIndex(q.answer, options) };
    });

  const checked = listeningScriptSchema.safeParse({
    title: value.title,
    speakers: speakers.slice(0, 4),
    lines: fixedLines,
    questions,
  });
  if (!checked.success) return { ok: false, error: firstIssue(checked.error) };
  const script = checked.data;
  // Drop questions whose answer points outside the options.
  script.questions = script.questions.filter((q) => q.answer < q.options.length);
  return { ok: true, content: script };
}

export function parseGrammarNote(raw: string): MaterialParse<GrammarNote> {
  const value = unwrap(extractJsonValue(raw), ['note', 'lesson', 'grammar']);
  if (!isObject(value)) return { ok: false, error: 'No JSON found in the answer' };
  const sections = (Array.isArray(value.sections) ? value.sections : [])
    .filter(isObject)
    .map((s) => {
      const table = isObject(s.table) ? s.table : null;
      return {
        ...s,
        // Tables without rows are dropped rather than failing the whole note.
        table:
          table && Array.isArray(table.rows) && table.rows.length && Array.isArray(table.headers)
            ? {
                headers: table.headers.map(String),
                rows: table.rows.filter(Array.isArray).map((r: unknown[]) => r.map(String)),
              }
            : null,
      };
    });
  const checked = grammarNoteSchema.safeParse({ ...value, sections });
  if (!checked.success) return { ok: false, error: firstIssue(checked.error) };
  return { ok: true, content: checked.data };
}
