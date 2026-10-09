/**
 * The activity log (Settings → Advanced → Log page). Requests are recorded by
 * `activityLogger()`: every one in advanced mode, otherwise only failures, so the history is
 * there when someone turns it on after a problem. Model calls aren't copied: `listLogs()` merges
 * them in from `ai_generations`.
 */
import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import type {
  ClientLog,
  LogCategory,
  LogEntryDto,
  LogLevel,
  LogPageDto,
  LogQuery,
} from '@alivocab/shared';
import { and, desc, eq, inArray, isNotNull, lt, or } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { AuthUser } from '../types.ts';
import { logger } from './logger.ts';

const { aiGenerations, appLogs, userProfiles } = schema;

export const LOG_RETENTION_DAYS = 14;
const DAY_MS = 86_400_000;
/** Prompts and answers are cut to this many characters in the list. */
const MAX_TEXT = 6_000;

/** Paths not worth a line each: images, cached audio, session polling and the log itself. */
const QUIET_PATHS = [/^\/api\/media\//, /^\/api\/tts\/audio\//, /^\/api\/auth\//, /^\/api\/logs/];

export function isAdvancedMode(db: Db, userId: string): boolean {
  return (
    db
      .select({ on: userProfiles.advancedMode })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .get()?.on ?? false
  );
}

let lastPrune = 0;

/** Deletes entries past the retention period, at most once an hour. */
function prune(db: Db, now: number) {
  if (now - lastPrune < 3_600_000) return;
  lastPrune = now;
  db.delete(appLogs)
    .where(lt(appLogs.createdAt, new Date(now - LOG_RETENTION_DAYS * DAY_MS)))
    .run();
}

export function recordLog(
  db: Db,
  entry: {
    userId: string;
    level: LogLevel;
    category: 'request' | 'app';
    message: string;
    status?: number | null;
    durationMs?: number | null;
    details?: Record<string, unknown> | null;
  },
) {
  try {
    db.insert(appLogs)
      .values({
        userId: entry.userId,
        level: entry.level,
        category: entry.category,
        message: entry.message.slice(0, 500),
        status: entry.status ?? null,
        durationMs: entry.durationMs ?? null,
        details: entry.details ?? null,
      })
      .run();
    prune(db, Date.now());
  } catch (err) {
    // Logging must never break the request it describes.
    logger.error({ err }, 'activity log write failed');
  }
}

/** Records an API request once it has been answered. Must be mounted before the routes. */
export const activityLogger = (db: Db) =>
  createMiddleware<{ Variables: { user?: AuthUser } }>(async (c, next) => {
    const started = Date.now();
    await next();
    const path = c.req.path;
    if (QUIET_PATHS.some((re) => re.test(path))) return;
    const user = c.get('user');
    if (!user) return;
    const status = c.res.status;
    const level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    // A signed-out session (401) or a stale link (404) isn't a problem worth keeping.
    const problem = level !== 'info' && status !== 401 && status !== 404;
    if (!problem && !isAdvancedMode(db, user.id)) return;

    const details: Record<string, unknown> = {};
    const query = new URL(c.req.url).search;
    if (query) details.query = query;
    if (c.error) {
      details.error = c.error.message;
      // Internals of unexpected errors are only shown to admins.
      if (!(c.error instanceof HTTPException) && user.role !== 'admin') {
        details.error = 'Internal server error';
      } else if (!(c.error instanceof HTTPException) && c.error.stack) {
        details.stack = c.error.stack;
      }
    } else if (level !== 'info' && c.res.headers.get('content-type')?.includes('json')) {
      const body = (await c.res
        .clone()
        .json()
        .catch(() => null)) as { error?: unknown; issues?: unknown } | null;
      if (body?.error) details.error = body.error;
      if (body?.issues) details.issues = body.issues;
    }
    const streamed = c.res.headers.get('content-type')?.startsWith('text/plain');
    if (streamed) details.note = 'Streamed answer: the time is until the stream started.';

    recordLog(db, {
      userId: user.id,
      level,
      category: 'request',
      message: `${c.req.method} ${path}`,
      status,
      durationMs: Date.now() - started,
      details: Object.keys(details).length ? details : null,
    });
  });

export function recordClientLog(db: Db, userId: string, log: ClientLog) {
  const level = log.level ?? 'error';
  // Problems are kept like failed requests; anything else only in advanced mode.
  if (level === 'info' && !isAdvancedMode(db, userId)) return;
  recordLog(db, {
    userId,
    level,
    category: 'app',
    message: log.message,
    details: { ...(log.context ? { context: log.context } : {}), ...log.details },
  });
}

const clip = (text: string | null) =>
  text && text.length > MAX_TEXT
    ? `${text.slice(0, MAX_TEXT)}… (${text.length - MAX_TEXT} more characters)`
    : text;

/** Newest first, merging recorded entries with the user's model calls. */
export function listLogs(db: Db, userId: string, query: LogQuery): LogPageDto {
  const { before, level, category, limit } = query;
  const entries: LogEntryDto[] = [];
  const beforeDate = before ? new Date(before) : undefined;

  if (category !== 'ai') {
    const rows = db
      .select()
      .from(appLogs)
      .where(
        and(
          eq(appLogs.userId, userId),
          category ? eq(appLogs.category, category) : undefined,
          level === 'problems' ? inArray(appLogs.level, ['warn', 'error']) : undefined,
          beforeDate ? lt(appLogs.createdAt, beforeDate) : undefined,
        ),
      )
      .orderBy(desc(appLogs.createdAt))
      .limit(limit)
      .all();
    for (const r of rows) {
      entries.push({
        id: r.id,
        at: r.createdAt.toISOString(),
        level: r.level,
        category: r.category as LogCategory,
        message: r.message,
        status: r.status,
        durationMs: r.durationMs,
        details: r.details ?? null,
      });
    }
  }

  if (!category || category === 'ai') {
    const rows = db
      .select()
      .from(aiGenerations)
      .where(
        and(
          eq(aiGenerations.userId, userId),
          level === 'problems'
            ? or(isNotNull(aiGenerations.error), eq(aiGenerations.parsedOk, false))
            : undefined,
          beforeDate ? lt(aiGenerations.createdAt, beforeDate) : undefined,
        ),
      )
      .orderBy(desc(aiGenerations.createdAt))
      .limit(limit)
      .all();
    for (const r of rows) {
      const where = r.provider ? ` · ${r.provider}${r.model ? ` / ${r.model}` : ''}` : '';
      entries.push({
        id: `ai:${r.id}`,
        at: r.createdAt.toISOString(),
        level: r.error ? 'error' : r.parsedOk ? 'info' : 'warn',
        category: 'ai',
        message: `${r.kind.replaceAll('_', ' ')} (${r.source})${where}${
          r.error ? ` — ${r.error}` : r.parsedOk ? '' : ' — answer could not be read'
        }`,
        status: null,
        durationMs: null,
        details: {
          promptVersion: r.promptVersion,
          ...(r.error ? { error: r.error } : {}),
          ...(r.tokensIn != null ? { tokensIn: r.tokensIn, tokensOut: r.tokensOut } : {}),
          prompt: clip(r.prompt),
          answer: clip(r.rawOutput),
        },
      });
    }
  }

  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const page = entries.slice(0, limit);
  const last = page.at(-1);
  return {
    entries: page,
    nextBefore: page.length === limit && last ? Date.parse(last.at) : null,
    recordingAll: isAdvancedMode(db, userId),
  };
}
