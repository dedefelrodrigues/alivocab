import { schema } from '@alivocab/db';
import {
  pictureChoiceSchema,
  pictureLinkSchema,
  pictureVisibilitySchema,
  SHARED_WORD_FIELDS,
  statusUpdateSchema,
  wordUpdateSchema,
} from '@alivocab/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { nativeLangs } from '../lib/languages.ts';
import { MAX_UPLOAD_BYTES } from '../lib/pictures/store.ts';
import { rateLimitPerUser } from '../lib/rate-limit.ts';
import { reseedCards } from '../lib/srs.ts';
import { validate } from '../lib/validate.ts';
import { isSharedWithOthers } from '../lib/vocab.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

const { userLexemes, lexemes, lexemeTranslations } = schema;

/** Per-user word state (tags, notes) plus guarded edits of shared dictionary fields. */
export const wordRoutes = ({ db, auth, pictures }: AppDeps) => {
  const findOwn = (userId: string, lexemeId: string) => {
    const row = db
      .select()
      .from(userLexemes)
      .where(and(eq(userLexemes.userId, userId), eq(userLexemes.lexemeId, lexemeId)))
      .get();
    if (!row) throw new HTTPException(404, { message: 'Word not found in your dictionary' });
    return row;
  };

  return new Hono<AuthedEnv>()
    .use(requireAuth(auth))
    .post('/:lexemeId/picture', validate('json', pictureChoiceSchema), async (c) => {
      const user = c.get('user');
      const lexemeId = c.req.param('lexemeId');
      // Choosing for a word nobody else uses (or as admin) also replaces the shared default.
      const canSetDefault = user.role === 'admin' || !isSharedWithOthers(db, user.id, lexemeId);
      return c.json(await pictures.choose(user.id, lexemeId, c.req.valid('json'), canSetDefault));
    })
    .post(
      '/:lexemeId/picture/upload',
      bodyLimit({
        maxSize: MAX_UPLOAD_BYTES + 64 * 1024,
        onError: () => {
          throw new HTTPException(413, { message: 'Pictures can be at most 8 MB' });
        },
      }),
      async (c) => {
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File))
          throw new HTTPException(400, { message: 'Attach a picture as "file"' });
        const data = Buffer.from(await file.arrayBuffer());
        return c.json(await pictures.upload(c.get('user').id, c.req.param('lexemeId'), data));
      },
    )
    .post(
      '/:lexemeId/picture/link',
      rateLimitPerUser({ max: 30, windowMs: 10 * 60_000 }),
      validate('json', pictureLinkSchema),
      async (c) =>
        c.json(
          await pictures.fromLink(
            c.get('user').id,
            c.req.param('lexemeId'),
            c.req.valid('json').url,
          ),
        ),
    )
    .put('/:lexemeId/picture/visibility', validate('json', pictureVisibilitySchema), (c) => {
      pictures.setHidden(c.get('user').id, c.req.param('lexemeId'), c.req.valid('json').hidden);
      return c.json({ hidden: c.req.valid('json').hidden });
    })
    .patch('/:lexemeId/status', validate('json', statusUpdateSchema), (c) => {
      const userId = c.get('user').id;
      const own = findOwn(userId, c.req.param('lexemeId'));
      const { status } = c.req.valid('json');
      db.transaction((tx) => {
        tx.update(userLexemes)
          .set({ status, statusSource: 'manual' })
          .where(and(eq(userLexemes.userId, userId), eq(userLexemes.lexemeId, own.lexemeId)))
          .run();
        // A manual re-tag restarts scheduling from the tag's starting point.
        if (status !== own.status) reseedCards(tx, userId, own.lexemeId, status, new Date());
      });
      return c.json({ lexemeId: own.lexemeId, status });
    })
    .patch('/:lexemeId', validate('json', wordUpdateSchema), (c) => {
      const user = c.get('user');
      const own = findOwn(user.id, c.req.param('lexemeId'));
      const { note, mnemonic, translations, aspectPair, ...rest } = c.req.valid('json');
      const input = c.req.valid('json');

      const touchesShared = SHARED_WORD_FIELDS.some((f) => input[f] !== undefined);
      if (touchesShared && user.role !== 'admin' && isSharedWithOthers(db, user.id, own.lexemeId)) {
        throw new HTTPException(403, {
          message: 'Other learners use this word, so its dictionary details are read-only for now.',
        });
      }

      db.transaction((tx) => {
        if (note !== undefined || mnemonic !== undefined) {
          tx.update(userLexemes)
            .set({
              ...(note !== undefined && { note }),
              ...(mnemonic !== undefined && { mnemonic }),
            })
            .where(and(eq(userLexemes.userId, user.id), eq(userLexemes.lexemeId, own.lexemeId)))
            .run();
        }
        const lexemeFields = {
          ...rest,
          ...(aspectPair !== undefined && { aspectPairLemma: aspectPair }),
        };
        if (Object.keys(lexemeFields).length) {
          tx.update(lexemes).set(lexemeFields).where(eq(lexemes.id, own.lexemeId)).run();
        }
        if (translations) {
          // Stored in the translation language of the word's own learning language.
          const word = tx
            .select({ lang: lexemes.lang })
            .from(lexemes)
            .where(eq(lexemes.id, own.lexemeId))
            .get();
          const lang = nativeLangs(tx, user.id)(word?.lang ?? '');
          tx.delete(lexemeTranslations)
            .where(
              and(eq(lexemeTranslations.lexemeId, own.lexemeId), eq(lexemeTranslations.lang, lang)),
            )
            .run();
          [...new Set(translations)].forEach((text, sort) => {
            tx.insert(lexemeTranslations)
              .values({ lexemeId: own.lexemeId, lang, text, sort })
              .run();
          });
        }
      });
      return c.json({ lexemeId: own.lexemeId });
    });
};
