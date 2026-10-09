import { schema } from '@alivocab/db';
import type { MaterialDto, MaterialSummaryDto, ThemeSummaryDto } from '@alivocab/shared';
import { MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.ts';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

const script = {
  title: 'Na targu',
  speakers: [
    { id: 'A', name: 'Ania' },
    { id: 'B', name: 'Tomek' },
  ],
  lines: [
    { speaker: 'A', text: 'Poproszę kilo jabłek.', translation: 'A kilo of apples, please.' },
    {
      speaker: 'B',
      text: 'Proszę, oto jabłka i jedna gruszka.',
      translation: 'Here are the apples and a pear.',
    },
  ],
  questions: [{ question: 'What does Ania buy?', options: ['Apples', 'Bread'], answer: 0 }],
};

const note = {
  title: 'The genitive',
  summary: null,
  sections: [
    {
      heading: 'Kilo + genitive plural',
      explanation: 'Quantities take the genitive.',
      examples: [{ text: 'Kilo jabłek.', translation: 'A kilo of apples.' }],
      table: { headers: ['Nominative', 'Genitive plural'], rows: [['jabłko', 'jabłek']] },
    },
  ],
  tips: [],
};

async function setup(answer = JSON.stringify(script)) {
  const prompts: string[] = [];
  const ctx = createTestApp({
    modelFactory: () =>
      new MockLanguageModelV4({
        doGenerate: async ({ prompt }) => {
          prompts.push(JSON.stringify(prompt));
          return {
            content: [{ type: 'text', text: answer }],
            finishReason: { unified: 'stop', raw: undefined },
            usage,
            warnings: [],
          };
        },
      }),
  });
  const cookie = await ctx.createUser('a@test.dev');
  const words = [
    {
      lemma: 'jabłko',
      pos: 'noun',
      translations: ['apple'],
      forms: { gen_pl: 'jabłek', nom_pl: 'jabłka' },
    },
    { lemma: 'gruszka', pos: 'noun', translations: ['pear'] },
    { lemma: 'śliwka', pos: 'noun', translations: ['plum'] },
  ];
  const theme = (await (
    await ctx.call('/api/themes', { method: 'POST', cookie, body: { name: 'Owoce', words } })
  ).json()) as ThemeSummaryDto;
  return { ...ctx, cookie, theme, prompts };
}

describe('materials', () => {
  it('builds prompts with the theme words and validates options', async () => {
    const ctx = await setup();
    const res = await ctx.call(`/api/themes/${ctx.theme.id}/materials/listening/prompt`, {
      method: 'POST',
      cookie: ctx.cookie,
      body: { options: { style: 'story', length: 'medium' } },
    });
    const { prompt } = (await res.json()) as { prompt: string };
    expect(prompt).toContain('a short story or monologue');
    expect(prompt).toContain('- jabłko (noun: apple)');
    const bad = await ctx.call(`/api/themes/${ctx.theme.id}/materials/listening/prompt`, {
      method: 'POST',
      cookie: ctx.cookie,
      body: { options: { style: 'opera' } },
    });
    expect(bad.status).toBe(400);
  });

  it('saves a pasted script and links the theme words it uses (by form too)', async () => {
    const ctx = await setup();
    const res = await ctx.call(`/api/themes/${ctx.theme.id}/materials/listening/import`, {
      method: 'POST',
      cookie: ctx.cookie,
      body: { options: {}, raw: `\`\`\`json\n${JSON.stringify(script)}\n\`\`\`` },
    });
    expect(res.status).toBe(200);
    const material = (await res.json()) as MaterialDto;
    expect(material).toMatchObject({
      kind: 'listening',
      title: 'Na targu',
      lang: 'pl',
      wordCount: 2,
    });
    expect(material.words.map((w) => w.lemma)).toEqual(['gruszka', 'jabłko']);

    const list = (await (
      await ctx.call(`/api/themes/${ctx.theme.id}/materials`, { cookie: ctx.cookie })
    ).json()) as MaterialSummaryDto[];
    expect(list).toEqual([
      expect.objectContaining({ id: material.id, kind: 'listening', wordCount: 2 }),
    ]);

    // Listening counts as an exposure for those words.
    await ctx.call(`/api/materials/${material.id}/seen`, { method: 'POST', cookie: ctx.cookie });
    const exposures = ctx.db
      .select()
      .from(schema.exposures)
      .where(eq(schema.exposures.context, 'listening'))
      .all();
    expect(exposures).toHaveLength(2);
    expect(exposures[0]?.lessonId).toBe(material.id);
  });

  it('reports answers it cannot read', async () => {
    const ctx = await setup();
    const res = await ctx.call(`/api/themes/${ctx.theme.id}/materials/grammar/import`, {
      method: 'POST',
      cookie: ctx.cookie,
      body: { options: {}, raw: 'Sorry, I cannot help.' },
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/^Could not read the answer/);
    expect(ctx.db.select().from(schema.aiGenerations).get()).toMatchObject({
      kind: 'grammar_note',
      parsedOk: false,
    });
  });

  it('generates a grammar note with the user’s key', async () => {
    const ctx = await setup(JSON.stringify(note));
    const cred = (await (
      await ctx.call('/api/credentials', {
        method: 'POST',
        cookie: ctx.cookie,
        body: { provider: 'anthropic', label: 'Claude', apiKey: 'sk-ant-test-1234' },
      })
    ).json()) as { id: string };
    const res = await ctx.call(`/api/themes/${ctx.theme.id}/materials/grammar/generate`, {
      method: 'POST',
      cookie: ctx.cookie,
      body: { credentialId: cred.id, options: { focus: 'genitive' } },
    });
    expect(res.status).toBe(200);
    const material = (await res.json()) as MaterialDto;
    expect(material.kind).toBe('grammar');
    expect(material.words.map((w) => w.lemma)).toEqual(['jabłko']);
    expect(ctx.prompts[0]).toContain('Topic: genitive.');
    expect(ctx.db.select().from(schema.aiGenerations).get()).toMatchObject({
      kind: 'grammar_note',
      source: 'api',
      parsedOk: true,
      promptVersion: 'grammar-note@1',
    });
  });

  it('keeps materials private and deletable', async () => {
    const ctx = await setup();
    const material = (await (
      await ctx.call(`/api/themes/${ctx.theme.id}/materials/listening/import`, {
        method: 'POST',
        cookie: ctx.cookie,
        body: { options: {}, raw: JSON.stringify(script) },
      })
    ).json()) as MaterialDto;
    const bob = await ctx.createUser('bob@test.dev');
    expect((await ctx.call(`/api/materials/${material.id}`, { cookie: bob })).status).toBe(404);
    expect((await ctx.call(`/api/themes/${ctx.theme.id}/materials`, { cookie: bob })).status).toBe(
      404,
    );
    expect(
      (await ctx.call(`/api/materials/${material.id}`, { method: 'DELETE', cookie: ctx.cookie }))
        .status,
    ).toBe(200);
    expect((await ctx.call(`/api/materials/${material.id}`, { cookie: ctx.cookie })).status).toBe(
      404,
    );
  });
});
