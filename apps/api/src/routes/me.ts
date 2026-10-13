import { schema } from '@alivocab/db';
import { type MeDto, profileUpdateSchema, type UserRole } from '@alivocab/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { listLanguages, syncActiveLanguage } from '../lib/languages.ts';
import { getOrCreateProfile } from '../lib/profile.ts';
import { validate } from '../lib/validate.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

export const meRoutes = ({ db, auth }: AppDeps) =>
  new Hono<AuthedEnv>()
    .use(requireAuth(auth))
    .get('/', (c) => {
      const user = c.get('user');
      const me: MeDto = {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: (user.role === 'admin' ? 'admin' : 'user') satisfies UserRole,
        },
        profile: getOrCreateProfile(db, user.id),
        languages: listLanguages(db, user.id),
      };
      return c.json(me);
    })
    .patch('/profile', validate('json', profileUpdateSchema), (c) => {
      const userId = c.get('user').id;
      const patch = c.req.valid('json');

      if (patch.defaultAiSource?.startsWith('api:')) {
        const credentialId = patch.defaultAiSource.slice(4);
        const owned = db
          .select({ id: schema.aiCredentials.id })
          .from(schema.aiCredentials)
          .where(
            and(eq(schema.aiCredentials.id, credentialId), eq(schema.aiCredentials.userId, userId)),
          )
          .get();
        if (!owned) throw new HTTPException(400, { message: 'Unknown AI credential' });
      }

      getOrCreateProfile(db, userId);
      db.transaction((tx) => {
        tx.update(schema.userProfiles)
          .set(patch)
          .where(eq(schema.userProfiles.userId, userId))
          .run();
        syncActiveLanguage(tx, userId, patch);
      });
      return c.json(getOrCreateProfile(db, userId));
    });
