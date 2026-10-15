import { gradeSchema, queueQuerySchema, summaryQuerySchema } from '@alivocab/shared';
import { Hono } from 'hono';
import { buildQueue, gradeCard, reviewSummary } from '../lib/srs.ts';
import { validate } from '../lib/validate.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

export const reviewRoutes = ({ db, auth }: AppDeps) =>
  new Hono<AuthedEnv>()
    .use(requireAuth(auth))
    // Both cover one learning language: a theme's, else `lang`, else the active one.
    .get('/queue', validate('query', queueQuerySchema), (c) =>
      c.json(buildQueue(db, c.get('user').id, c.req.valid('query'))),
    )
    .get('/summary', validate('query', summaryQuerySchema), (c) =>
      c.json(reviewSummary(db, c.get('user').id, c.req.valid('query'))),
    )
    .post('/cards/:cardId', validate('json', gradeSchema), (c) =>
      c.json(gradeCard(db, c.get('user').id, c.req.param('cardId'), c.req.valid('json'))),
    );
