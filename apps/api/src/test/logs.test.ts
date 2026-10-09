import { schema } from '@alivocab/db';
import type { LogPageDto } from '@alivocab/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.ts';

async function setup() {
  const ctx = createTestApp();
  const cookie = await ctx.createUser('a@test.dev');
  const userId = ctx.db.select().from(schema.user).where(eq(schema.user.email, 'a@test.dev')).get()
    ?.id as string;
  const logs = async (query = '', as = cookie) =>
    (await (await ctx.call(`/api/logs${query}`, { cookie: as })).json()) as LogPageDto;
  return { ...ctx, cookie, userId, logs };
}

describe('activity log', () => {
  it('keeps failed requests always, and every request in advanced mode', async () => {
    const ctx = await setup();
    await ctx.call('/api/themes', { cookie: ctx.cookie });
    await ctx.call('/api/themes', { method: 'POST', cookie: ctx.cookie, body: { name: '' } });

    let page = await ctx.logs();
    expect(page.recordingAll).toBe(false);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({
      level: 'warn',
      category: 'request',
      message: 'POST /api/themes',
      status: 400,
      details: { error: 'Invalid request' },
    });

    await ctx.call('/api/me/profile', {
      method: 'PATCH',
      cookie: ctx.cookie,
      body: { advancedMode: true },
    });
    await ctx.call('/api/themes?x=1', { cookie: ctx.cookie });
    page = await ctx.logs();
    expect(page.recordingAll).toBe(true);
    expect(page.entries[0]).toMatchObject({
      level: 'info',
      message: 'GET /api/themes',
      status: 200,
      details: { query: '?x=1' },
    });
    expect(page.entries[0]?.durationMs).toBeGreaterThanOrEqual(0);
    // Reading the log isn't logged.
    expect(page.entries.some((e) => e.message.startsWith('GET /api/logs'))).toBe(false);

    expect((await ctx.logs('?level=problems')).entries.map((e) => e.status)).toEqual([400]);
  });

  it('shows each user only their own entries', async () => {
    const ctx = await setup();
    await ctx.call('/api/themes', { method: 'POST', cookie: ctx.cookie, body: { name: '' } });
    const other = await ctx.createUser('b@test.dev');
    expect((await ctx.logs('', other)).entries).toEqual([]);
    expect((await ctx.call('/api/logs')).status).toBe(401);
  });

  it('records problems reported by the web app', async () => {
    const ctx = await setup();
    const report = (body: unknown) =>
      ctx.call('/api/logs/client', { method: 'POST', cookie: ctx.cookie, body });
    expect(
      (
        await report({
          message: 'Network error',
          context: 'role-play',
          details: { chatId: 'c1' },
        })
      ).status,
    ).toBe(204);
    // Plain information is only kept in advanced mode.
    await report({ level: 'info', message: 'Opened the page' });
    expect((await report({ message: '' })).status).toBe(400);

    const { entries } = await ctx.logs('?category=app');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'error',
      category: 'app',
      message: 'Network error',
      details: { context: 'role-play', chatId: 'c1' },
    });
  });

  it('merges in model calls with their prompt and answer', async () => {
    const ctx = await setup();
    const at = Date.now();
    ctx.db
      .insert(schema.aiGenerations)
      .values([
        {
          userId: ctx.userId,
          kind: 'roleplay',
          source: 'api',
          provider: 'deepseek',
          model: 'deepseek-chat',
          promptVersion: 'roleplay@1',
          prompt: 'Dzień dobry',
          rawOutput: '<reply>Dzień dobry!</reply>',
          parsedOk: true,
          tokensIn: 10,
          tokensOut: 5,
          createdAt: new Date(at - 2000),
        },
        {
          userId: ctx.userId,
          kind: 'roleplay',
          source: 'api',
          provider: 'deepseek',
          model: 'deepseek-chat',
          promptVersion: 'roleplay@1',
          prompt: 'Poproszę chleb',
          rawOutput: null,
          parsedOk: false,
          error: 'The provider is rate-limiting requests.',
          createdAt: new Date(at - 1000),
        },
      ])
      .run();
    await ctx.call('/api/themes', { method: 'POST', cookie: ctx.cookie, body: { name: '' } });

    const page = await ctx.logs();
    expect(page.entries.map((e) => e.category)).toEqual(['request', 'ai', 'ai']);
    expect(page.entries[1]).toMatchObject({
      level: 'error',
      message:
        'roleplay (api) · deepseek / deepseek-chat — The provider is rate-limiting requests.',
      details: { error: 'The provider is rate-limiting requests.', prompt: 'Poproszę chleb' },
    });
    expect(page.entries[2]).toMatchObject({
      level: 'info',
      details: { tokensIn: 10, tokensOut: 5, answer: '<reply>Dzień dobry!</reply>' },
    });
    expect((await ctx.logs('?category=ai&level=problems')).entries).toHaveLength(1);

    // Paging: two at a time, then the rest.
    const first = await ctx.logs('?limit=2');
    expect(first.entries).toHaveLength(2);
    expect(first.nextBefore).not.toBeNull();
    const rest = await ctx.logs(`?limit=2&before=${first.nextBefore}`);
    expect(rest.entries.map((e) => e.details?.prompt)).toEqual(['Dzień dobry']);
    expect(rest.nextBefore).toBeNull();
  });
});
