import { Hono } from 'hono';

export const health = new Hono().get('/', (c) =>
  c.json({ status: 'ok' as const, service: 'alivocab-api', time: new Date().toISOString() }),
);
