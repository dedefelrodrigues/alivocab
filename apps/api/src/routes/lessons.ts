import { lessonQuerySchema, practiceResultSchema } from '@alivocab/shared';
import { Hono } from 'hono';
import { buildLesson, recordPractice } from '../lib/lessons.ts';
import { validate } from '../lib/validate.ts';
import { findOwnedTheme } from '../lib/vocab.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

/** Mixed-exercise lessons. Graded answers go to `POST /api/review/cards/:cardId`. */
export const lessonRoutes = ({ db, auth }: AppDeps) =>
  new Hono<AuthedEnv>()
    .use(requireAuth(auth))
    .get('/', validate('query', lessonQuerySchema), (c) => {
      const userId = c.get('user').id;
      const query = c.req.valid('query');
      if (query.themeId) findOwnedTheme(db, userId, query.themeId);
      return c.json(buildLesson(db, userId, query));
    })
    .post('/practice', validate('json', practiceResultSchema), (c) => {
      recordPractice(db, c.get('user').id, c.req.valid('json'));
      return c.json({ ok: true });
    });
