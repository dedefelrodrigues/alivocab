import { gradeSchema, queueQuerySchema, summaryQuerySchema } from '@alivocab/shared';
import { Hono } from 'hono';
import { buildQueue, gradeCard, reviewSummary } from '../lib/srs.ts';
import { validate } from '../lib/validate.ts';
import { findOwnedTheme } from '../lib/vocab.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

export const reviewRoutes = ({ db, auth }: AppDeps) =>
  new Hono<AuthedEnv>()
    .use(requireAuth(auth))
    .get('/queue', validate('query', queueQuerySchema), (c) => {
      const userId = c.get('user').id;
      const query = c.req.valid('query');
      if (query.themeId) findOwnedTheme(db, userId, query.themeId);
      return c.json(buildQueue(db, userId, query));
    })
    .get('/summary', validate('query', summaryQuerySchema), (c) =>
      c.json(reviewSummary(db, c.get('user').id, c.req.valid('query').tzOffset)),
    )
    .post('/cards/:cardId', validate('json', gradeSchema), (c) =>
      c.json(gradeCard(db, c.get('user').id, c.req.param('cardId'), c.req.valid('json'))),
    );
