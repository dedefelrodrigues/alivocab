import type { ClientLog } from '@alivocab/shared';
import { MutationCache, QueryCache } from '@tanstack/react-query';
import { ApiError, errorMessage } from './api.ts';

/** Same message within this time is reported once. */
const DEDUPE_MS = 10_000;
const MAX_PER_MINUTE = 20;
const recent = new Map<string, number>();
let sentAt: number[] = [];

/**
 * Sends a problem to the activity log (Settings → Advanced → Log). For failures the server
 * can't see: the network, broken streams, audio playback, crashes. Never throws.
 */
export function reportProblem(
  message: string,
  { level = 'error', context, details }: Omit<ClientLog, 'message'> = {},
) {
  const now = Date.now();
  const key = `${level}\u0000${context ?? ''}\u0000${message}`;
  if (now - (recent.get(key) ?? 0) < DEDUPE_MS) return;
  recent.set(key, now);
  sentAt = sentAt.filter((t) => now - t < 60_000);
  if (sentAt.length >= MAX_PER_MINUTE) return;
  sentAt.push(now);
  const body: ClientLog = {
    level,
    message: message.slice(0, 500),
    context: context ?? window.location.pathname,
    details: { ...details, page: window.location.pathname },
  };
  // Plain fetch: reporting must not go through (and re-trigger) the query error handlers.
  void fetch('/api/logs/client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    // Offline: nothing to do.
  });
}

/**
 * Failed requests that reached the API are already in its log; the rest (offline, timeouts,
 * code errors) are reported from here.
 */
function onQueryError(err: unknown, context: string) {
  if (err instanceof ApiError) return;
  reportProblem(errorMessage(err), { context, details: { kind: 'request' } });
}

export const reportingQueryCache = () =>
  new QueryCache({
    onError: (err, query) => onQueryError(err, `loading ${JSON.stringify(query.queryKey)}`),
  });

export const reportingMutationCache = () =>
  new MutationCache({
    onError: (err, _vars, _ctx, mutation) =>
      onQueryError(
        err,
        `saving${mutation.options.mutationKey ? ` ${JSON.stringify(mutation.options.mutationKey)}` : ''}`,
      ),
  });

/** Reports crashes and unhandled promise failures. */
export function reportUncaughtErrors() {
  window.addEventListener('error', (e) => {
    reportProblem(e.message || 'Script error', {
      context: 'uncaught error',
      details: e.filename ? { source: `${e.filename}:${e.lineno}:${e.colno}` } : undefined,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (e.reason instanceof ApiError) return;
    reportProblem(errorMessage(e.reason), {
      context: 'unhandled promise',
      details: e.reason instanceof Error && e.reason.stack ? { stack: e.reason.stack } : undefined,
    });
  });
}
