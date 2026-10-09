import { statsQuerySchema } from '@alivocab/shared';
import { Hono } from 'hono';
import { buildStats } from '../lib/stats.ts';
import { validate } from '../lib/validate.ts';
import { findOwnedTheme } from '../lib/vocab.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

export const statsRoutes = ({ db, auth }: AppDeps) =>
  new Hono<AuthedEnv>()
    .use(requireAuth(auth))
    .get('/', validate('query', statsQuerySchema), (c) => {
      const userId = c.get('user').id;
      const query = c.req.valid('query');
      if (query.themeId) findOwnedTheme(db, userId, query.themeId);
      return c.json(buildStats(db, userId, query));
    });
