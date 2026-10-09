import { schema } from '@alivocab/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { findOwnedMaterial, materialDto, recordMaterialSeen } from '../lib/materials.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

const { lessons } = schema;

/** One listening script or grammar note (created via /api/themes/:id/materials). */
export const materialRoutes = ({ db, auth }: AppDeps) =>
  new Hono<AuthedEnv>()
    .use(requireAuth(auth))
    .get('/:id', (c) => {
      const userId = c.get('user').id;
      return c.json(materialDto(db, findOwnedMaterial(db, userId, c.req.param('id'))));
    })
    .delete('/:id', (c) => {
      const row = findOwnedMaterial(db, c.get('user').id, c.req.param('id'));
      db.delete(lessons).where(eq(lessons.id, row.id)).run();
      return c.json({ ok: true });
    })
    // Listening to or reading a material counts as seeing its words.
    .post('/:id/seen', (c) => {
      const userId = c.get('user').id;
      const row = findOwnedMaterial(db, userId, c.req.param('id'));
      return c.json({ words: recordMaterialSeen(db, userId, row) });
    });
