import { schema } from '@alivocab/db';
import type { RoleplayDto, Scenario, ThemeSummaryDto } from '@alivocab/shared';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.ts';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

const scenario: Scenario = {
  title: 'At the bakery',
  description: 'Buy bread for a party.',
  userRole: 'a customer',
  aiRole: 'the baker',
};

/** A model that streams `answers` in turn (in small pieces), recording the prompts. */
function chatModel(answers: string[], prompts: unknown[] = []) {
  // A new model is built per request; the turn follows the prompts seen so far.
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify({ scenarios: [scenario, { title: 'x' }] }) }],
      finishReason: { unified: 'stop', raw: undefined },
      usage,
      warnings: [],
    }),
    doStream: async ({ prompt }) => {
      prompts.push(prompt);
      const text = answers[prompts.length - 1] ?? '';
      const pieces = text.match(/.{1,7}/gs) ?? [];
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 't' },
            ...pieces.map((delta) => ({ type: 'text-delta' as const, id: 't', delta })),
            { type: 'text-end', id: 't' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
          ],
        }),
      };
    },
  });
}

async function setup(answers: string[]) {
  const prompts: unknown[] = [];
  const ctx = createTestApp({ modelFactory: () => chatModel(answers, prompts) });
  const cookie = await ctx.createUser('a@test.dev');
  const words = [
    { lemma: 'chleb', pos: 'noun', translations: ['bread'], forms: { nom_pl: 'chleby' } },
    { lemma: 'bułka', pos: 'noun', translations: ['roll'] },
  ];
  const theme = (await (
    await ctx.call('/api/themes', { method: 'POST', cookie, body: { name: 'Piekarnia', words } })
  ).json()) as ThemeSummaryDto;
  await ctx.call('/api/credentials', {
    method: 'POST',
    cookie,
    body: { provider: 'anthropic', label: 'Claude', apiKey: 'sk-ant-test-1234' },
  });
  return { ...ctx, cookie, theme, prompts };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

describe('role-play', () => {
  it('suggests scenarios, keeping only valid ones', async () => {
    const ctx = await setup([]);
    const res = await ctx.call(`/api/themes/${ctx.theme.id}/roleplay/suggest`, {
      method: 'POST',
      cookie: ctx.cookie,
      body: {},
    });
    expect(await res.json()).toEqual({ scenarios: [scenario] });
  });

  it('streams turns, saves corrections and counts theme words as seen', async () => {
    const ctx = await setup([
      '<correction>OK</correction><explanation></explanation><reply>Dzień dobry! Co podać?</reply><translation>Hello! What can I get you?</translation>',
      '<correction>Poproszę dwa chleby.</correction><explanation>After "dwa" use the plural "chleby".</explanation><reply>Proszę, dwa chleby. Coś jeszcze?</reply><translation>Here, two loaves. Anything else?</translation>',
    ]);
    const chat = (await (
      await ctx.call(`/api/themes/${ctx.theme.id}/roleplay`, {
        method: 'POST',
        cookie: ctx.cookie,
        body: { scenario, level: 'A2' },
      })
    ).json()) as RoleplayDto;

    // The partner opens.
    const opener = await ctx.call(`/api/roleplay/${chat.id}/messages`, {
      method: 'POST',
      cookie: ctx.cookie,
      body: {},
    });
    expect(opener.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await opener.text()).toContain('<reply>Dzień dobry! Co podać?</reply>');
    await flush();

    const turn = await ctx.call(`/api/roleplay/${chat.id}/messages`, {
      method: 'POST',
      cookie: ctx.cookie,
      body: { text: 'Poproszę dwa chleb.' },
    });
    await turn.text();
    await flush();

    const saved = (await (
      await ctx.call(`/api/roleplay/${chat.id}`, { cookie: ctx.cookie })
    ).json()) as RoleplayDto;
    expect(saved.content.messages).toEqual([
      {
        role: 'assistant',
        text: 'Dzień dobry! Co podać?',
        translation: 'Hello! What can I get you?',
      },
      {
        role: 'user',
        text: 'Poproszę dwa chleb.',
        correction: {
          corrected: 'Poproszę dwa chleby.',
          explanation: 'After "dwa" use the plural "chleby".',
        },
      },
      {
        role: 'assistant',
        text: 'Proszę, dwa chleby. Coś jeszcze?',
        translation: 'Here, two loaves. Anything else?',
      },
    ]);
    expect(saved.words.map((w) => w.lemma)).toEqual(['chleb']);
    expect(
      ctx.db.select().from(schema.exposures).where(eq(schema.exposures.context, 'roleplay')).all(),
    ).toHaveLength(1); // once per word per turn (the opener used no theme words)

    // The model got the scenario and the earlier turns.
    const second = JSON.stringify(ctx.prompts[1]);
    expect(second).toContain('You play: the baker');
    expect(second).toContain('Dzień dobry! Co podać?');
    expect(second).toContain('Poproszę dwa chleb.');
  });

  it('only lets the partner open an empty chat, and stops after finishing', async () => {
    const ctx = await setup(['<correction>OK</correction><reply>Cześć!</reply>']);
    const chat = (await (
      await ctx.call(`/api/themes/${ctx.theme.id}/roleplay`, {
        method: 'POST',
        cookie: ctx.cookie,
        body: { scenario },
      })
    ).json()) as RoleplayDto;
    await (
      await ctx.call(`/api/roleplay/${chat.id}/messages`, {
        method: 'POST',
        cookie: ctx.cookie,
        body: {},
      })
    ).text();
    await flush();
    const again = await ctx.call(`/api/roleplay/${chat.id}/messages`, {
      method: 'POST',
      cookie: ctx.cookie,
      body: {},
    });
    expect(again.status).toBe(400);

    const done = (await (
      await ctx.call(`/api/roleplay/${chat.id}/finish`, { method: 'POST', cookie: ctx.cookie })
    ).json()) as RoleplayDto;
    expect(done.content.finishedAt).toBeTruthy();
    const after = await ctx.call(`/api/roleplay/${chat.id}/messages`, {
      method: 'POST',
      cookie: ctx.cookie,
      body: { text: 'Hej' },
    });
    expect(after.status).toBe(400);

    // Listed with the theme's materials.
    const list = (await (
      await ctx.call(`/api/themes/${ctx.theme.id}/materials`, { cookie: ctx.cookie })
    ).json()) as Array<{ kind: string; title: string }>;
    expect(list).toEqual([expect.objectContaining({ kind: 'roleplay', title: 'At the bakery' })]);
  });

  it('keeps chats private', async () => {
    const ctx = await setup([]);
    const chat = (await (
      await ctx.call(`/api/themes/${ctx.theme.id}/roleplay`, {
        method: 'POST',
        cookie: ctx.cookie,
        body: { scenario },
      })
    ).json()) as RoleplayDto;
    const bob = await ctx.createUser('bob@test.dev');
    expect((await ctx.call(`/api/roleplay/${chat.id}`, { cookie: bob })).status).toBe(404);
    expect(
      (
        await ctx.call(`/api/roleplay/${chat.id}/messages`, {
          method: 'POST',
          cookie: bob,
          body: { text: 'x' },
        })
      ).status,
    ).toBe(404);
  });
});
