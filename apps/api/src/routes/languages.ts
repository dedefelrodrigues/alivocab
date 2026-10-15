import { languageAddSchema, languageCodeSchema, languageUpdateSchema } from '@alivocab/shared';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  activeLanguage,
  addLanguage,
  archiveLanguage,
  listLanguages,
  toLanguageDto,
  updateLanguage,
} from '../lib/languages.ts';
import { validate } from '../lib/validate.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

/** The languages a user learns (PLAN.md D31). Switching the active one is a profile update. */
export const languageRoutes = ({ db, auth }: AppDeps) => {
  const langParam = (raw: string) => {
    const parsed = languageCodeSchema.safeParse(raw);
    if (!parsed.success) throw new HTTPException(400, { message: 'Unknown language code' });
    return parsed.data;
  };

  return new Hono<AuthedEnv>()
    .use(requireAuth(auth))
    .get('/', (c) => c.json(listLanguages(db, c.get('user').id)))
    .post('/', validate('json', languageAddSchema), (c) => {
      const userId = c.get('user').id;
      const { row, created } = db.transaction((tx) => addLanguage(tx, userId, c.req.valid('json')));
      return c.json(toLanguageDto(row, activeLanguage(db, userId).lang), created ? 201 : 200);
    })
    .patch('/:lang', validate('json', languageUpdateSchema), (c) => {
      const userId = c.get('user').id;
      const lang = langParam(c.req.param('lang'));
      const row = db.transaction((tx) => updateLanguage(tx, userId, lang, c.req.valid('json')));
      return c.json(toLanguageDto(row, activeLanguage(db, userId).lang));
    })
    .delete('/:lang', (c) => {
      archiveLanguage(db, c.get('user').id, langParam(c.req.param('lang')));
      return c.body(null, 204);
    });
};
