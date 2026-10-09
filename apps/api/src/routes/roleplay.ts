import { schema } from '@alivocab/db';
import { roleplayMessageSchema } from '@alivocab/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { rateLimitPerUser } from '../lib/rate-limit.ts';
import {
  findOwnedRoleplay,
  finishRoleplay,
  roleplayDto,
  sendRoleplayMessage,
} from '../lib/roleplay.ts';
import { validate } from '../lib/validate.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

/** One role-play chat (started via /api/themes/:id/roleplay). */
export const roleplayRoutes = (deps: AppDeps) => {
  const { db, auth } = deps;
  return (
    new Hono<AuthedEnv>()
      .use(requireAuth(auth))
      .get('/:id', (c) =>
        c.json(roleplayDto(db, findOwnedRoleplay(db, c.get('user').id, c.req.param('id')))),
      )
      // Streams the partner's answer as plain text (tagged, see parseRoleplayTurn).
      .post(
        '/:id/messages',
        rateLimitPerUser({ max: 80, windowMs: 10 * 60_000 }),
        validate('json', roleplayMessageSchema),
        async (c) => {
          const userId = c.get('user').id;
          const row = findOwnedRoleplay(db, userId, c.req.param('id'));
          return sendRoleplayMessage(deps, userId, row, c.req.valid('json').text);
        },
      )
      .post('/:id/finish', (c) =>
        c.json(finishRoleplay(db, findOwnedRoleplay(db, c.get('user').id, c.req.param('id')))),
      )
      .delete('/:id', (c) => {
        const row = findOwnedRoleplay(db, c.get('user').id, c.req.param('id'));
        db.delete(schema.lessons).where(eq(schema.lessons.id, row.id)).run();
        return c.json({ ok: true });
      })
  );
};
