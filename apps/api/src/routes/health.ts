import { Hono } from 'hono';
import type { AppDeps } from '../types.ts';

/** Liveness for Docker and uptime checks: answers 503 if the database can't be read. */
export const healthRoutes = ({ db }: AppDeps) =>
  new Hono().get('/', (c) => {
    const base = {
      service: 'alivocab-api',
      version: process.env.APP_VERSION ?? 'dev',
      time: new Date().toISOString(),
    };
    try {
      db.$client.prepare('select 1').get();
    } catch {
      return c.json({ status: 'error' as const, ...base, error: 'Database unavailable' }, 503);
    }
    return c.json({ status: 'ok' as const, ...base });
  });
