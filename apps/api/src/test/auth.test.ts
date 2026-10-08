import { schema } from '@alivocab/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.ts';

describe('invite-gated sign-up', () => {
  it('rejects sign-up without an invite code', async () => {
    const { signUp, db } = createTestApp();
    const { res } = await signUp('a@test.dev');
    expect(res.status).toBe(403);
    expect(db.select().from(schema.user).all()).toHaveLength(0);
  });

  it('rejects an unknown invite code', async () => {
    const { signUp } = createTestApp();
    expect((await signUp('a@test.dev', 'NOPE')).res.status).toBe(403);
  });

  it('accepts a valid code, consumes it and creates a profile', async () => {
    const { signUp, addInvite, db, call } = createTestApp();
    addInvite('ALI-OK');
    const { res, cookie } = await signUp('a@test.dev', 'ALI-OK');
    expect(res.status).toBe(200);

    const invite = db
      .select()
      .from(schema.inviteCodes)
      .where(eq(schema.inviteCodes.code, 'ALI-OK'))
      .get();
    expect(invite?.uses).toBe(1);

    const me = await call('/api/me', { cookie });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      user: { email: 'a@test.dev', role: 'user' },
      profile: {
        targetLang: 'pl',
        colorPalette: 'auto',
        colorMode: 'system',
        defaultWordCount: 30,
      },
    });
  });

  it('does not allow a single-use code twice', async () => {
    const { signUp, addInvite } = createTestApp();
    addInvite('ALI-ONCE');
    expect((await signUp('a@test.dev', 'ALI-ONCE')).res.status).toBe(200);
    expect((await signUp('b@test.dev', 'ALI-ONCE')).res.status).toBe(403);
  });

  it('allows multi-use codes up to their limit', async () => {
    const { signUp, addInvite } = createTestApp();
    addInvite('ALI-TWO', { maxUses: 2 });
    expect((await signUp('a@test.dev', 'ALI-TWO')).res.status).toBe(200);
    expect((await signUp('b@test.dev', 'ALI-TWO')).res.status).toBe(200);
    expect((await signUp('c@test.dev', 'ALI-TWO')).res.status).toBe(403);
  });

  it('rejects expired and revoked codes', async () => {
    const { signUp, addInvite } = createTestApp();
    addInvite('ALI-OLD', { expiresAt: new Date(Date.now() - 1000) });
    addInvite('ALI-REV', { revokedAt: new Date() });
    expect((await signUp('a@test.dev', 'ALI-OLD')).res.status).toBe(403);
    expect((await signUp('b@test.dev', 'ALI-REV')).res.status).toBe(403);
  });

  it('does not burn an invite when the email is already taken', async () => {
    const { signUp, addInvite, createUser, db } = createTestApp();
    await createUser('taken@test.dev');
    addInvite('ALI-KEEP');
    const { res } = await signUp('taken@test.dev', 'ALI-KEEP');
    expect(res.ok).toBe(false);
    const invite = db
      .select()
      .from(schema.inviteCodes)
      .where(eq(schema.inviteCodes.code, 'ALI-KEEP'))
      .get();
    expect(invite?.uses).toBe(0);
  });
});

describe('protected routes', () => {
  it('returns 401 without a session', async () => {
    const { call } = createTestApp();
    expect((await call('/api/me')).status).toBe(401);
    expect((await call('/api/credentials')).status).toBe(401);
  });

  it('restricts admin routes to admins', async () => {
    const { call, createUser } = createTestApp();
    const user = await createUser('u@test.dev');
    const admin = await createUser('admin@test.dev', 'admin');
    expect((await call('/api/admin/invites', { cookie: user })).status).toBe(403);
    expect((await call('/api/admin/invites', { cookie: admin })).status).toBe(200);
  });
});

describe('admin invites', () => {
  it('creates, lists and revokes invites', async () => {
    const { call, createUser, signUp } = createTestApp();
    const admin = await createUser('admin@test.dev', 'admin');

    const created = await call('/api/admin/invites', {
      method: 'POST',
      cookie: admin,
      body: { maxUses: 1, expiresInDays: 7, note: 'for Kasia' },
    });
    expect(created.status).toBe(201);
    const invite = (await created.json()) as { id: string; code: string; status: string };
    expect(invite.code).toMatch(/^ALI-[2-9A-HJ-NP-Z]{8}$/);
    expect(invite.status).toBe('active');

    const revoked = await call(`/api/admin/invites/${invite.id}/revoke`, {
      method: 'POST',
      cookie: admin,
    });
    expect(await revoked.json()).toMatchObject({ status: 'revoked' });
    expect((await signUp('new@test.dev', invite.code)).res.status).toBe(403);
  });
});
