import { pino } from 'pino';

/**
 * Server log: one JSON line per event on stdout (`docker compose logs`, any log shipper).
 * Never log request bodies, cookies or keys.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'alivocab-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
});
