import { clientLogSchema, logQuerySchema } from '@alivocab/shared';
import { Hono } from 'hono';
import { listLogs, recordClientLog } from '../lib/activity.ts';
import { rateLimitPerUser } from '../lib/rate-limit.ts';
import { validate } from '../lib/validate.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

export const logRoutes = ({ db, auth }: AppDeps) =>
  new Hono<AuthedEnv>()
    .use(requireAuth(auth))
    .get('/', validate('query', logQuerySchema), (c) =>
      c.json(listLogs(db, c.get('user').id, c.req.valid('query'))),
    )
    // Problems the web app ran into (network failures, broken streams, crashes).
    .post(
      '/client',
      rateLimitPerUser({ max: 60, windowMs: 10 * 60_000 }),
      validate('json', clientLogSchema),
      (c) => {
        recordClientLog(db, c.get('user').id, c.req.valid('json'));
        return c.body(null, 204);
      },
    );
