/** The activity log: API requests, AI calls and problems the web app ran into. */
import { z } from 'zod';
import { LOG_CATEGORIES, LOG_LEVELS, type LogCategory, type LogLevel } from './enums.ts';

export const logQuerySchema = z.object({
  /** Only entries older than this (unix ms), for "Load older". */
  before: z.coerce.number().int().positive().optional(),
  /** `problems`: warnings and errors only. */
  level: z.enum(['all', 'problems']).default('all'),
  category: z.enum(LOG_CATEGORIES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type LogQuery = z.infer<typeof logQuerySchema>;

/** What the web app reports: failures the server can't see (network, streams, speech, crashes). */
export const clientLogSchema = z.object({
  level: z.enum(LOG_LEVELS).default('error'),
  message: z.string().trim().min(1).max(500),
  /** Where it happened, e.g. "role-play" or the page path. */
  context: z.string().max(200).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ClientLog = z.input<typeof clientLogSchema>;

export type LogEntryDto = {
  /** Unique across categories (`ai:` prefix for model calls). */
  id: string;
  at: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  /** HTTP status of a request. */
  status: number | null;
  durationMs: number | null;
  /** Anything else worth seeing: error text, prompt and raw answer, page, … */
  details: Record<string, unknown> | null;
};

export type LogPageDto = {
  entries: LogEntryDto[];
  /** Pass as `before` to load older entries; null at the end. */
  nextBefore: number | null;
  /** Whether every request is recorded (advanced mode) or only problems. */
  recordingAll: boolean;
};
