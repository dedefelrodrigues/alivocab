import { schema } from '@alivocab/db';
import { type InviteDto, inviteCreateSchema } from '@alivocab/shared';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { customAlphabet } from 'nanoid';
import { validate } from '../lib/validate.ts';
import { requireAdmin, requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

const { inviteCodes } = schema;
type Row = typeof inviteCodes.$inferSelect;

/** Unambiguous alphabet (no 0/O, 1/I/L) so codes are easy to read aloud or type. */
const randomCode = customAlphabet('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 8);

function inviteStatus(row: Row, now = new Date()): InviteDto['status'] {
  if (row.revokedAt) return 'revoked';
  if (row.uses >= row.maxUses) return 'used';
  if (row.expiresAt && row.expiresAt <= now) return 'expired';
  return 'active';
}

function toDto(row: Row): InviteDto {
  return {
    id: row.id,
    code: row.code,
    note: row.note,
    maxUses: row.maxUses,
    uses: row.uses,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    status: inviteStatus(row),
  };
}

/** Invite management. User management (list/ban/password) uses Better Auth's admin plugin. */
export const adminRoutes = ({ db, auth }: AppDeps) =>
  new Hono<AuthedEnv>()
    .use(requireAuth(auth), requireAdmin)
    .get('/invites', (c) => {
      const rows = db.select().from(inviteCodes).orderBy(desc(inviteCodes.createdAt)).all();
      return c.json(rows.map(toDto));
    })
    .post('/invites', validate('json', inviteCreateSchema), (c) => {
      const { maxUses, expiresInDays, note } = c.req.valid('json');
      const row = db
        .insert(inviteCodes)
        .values({
          code: `ALI-${randomCode()}`,
          maxUses,
          note: note || null,
          expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
          createdBy: c.get('user').id,
        })
        .returning()
        .get();
      return c.json(toDto(row), 201);
    })
    .post('/invites/:id/revoke', (c) => {
      const row = db
        .update(inviteCodes)
        .set({ revokedAt: new Date() })
        .where(eq(inviteCodes.id, c.req.param('id')))
        .returning()
        .get();
      if (!row) throw new HTTPException(404, { message: 'Invite not found' });
      return c.json(toDto(row));
    });
