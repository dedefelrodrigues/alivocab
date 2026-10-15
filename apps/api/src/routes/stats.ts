import { statsQuerySchema } from '@alivocab/shared';
import { Hono } from 'hono';
import { buildStats } from '../lib/stats.ts';
import { validate } from '../lib/validate.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

export const statsRoutes = ({ db, auth }: AppDeps) =>
  new Hono<AuthedEnv>()
    .use(requireAuth(auth))
    .get('/', validate('query', statsQuerySchema), (c) =>
      c.json(buildStats(db, c.get('user').id, c.req.valid('query'))),
    );
