import { schema } from '@alivocab/db';
import type { FillPromptDto, FillResultDto, ThemeSummaryDto } from '@alivocab/shared';
import { MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.ts';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

/** Two sentences per word named in the prompt ("- lemma (pos: translation)"). */
function sentenceModel(prompts: string[] = []) {
  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const text = JSON.stringify(prompt);
      prompts.push(text);
      const lemmas = [...text.matchAll(/\\n- (\S+) \(/g)].map((m) => m[1] ?? '');
      const rows = lemmas.flatMap((lemma) => [
        {
          lemma,
          pos: 'noun',
          translation: `${lemma}-en`,
          example: `Mam ${lemma}.`,
          example_translation: 'I have it.',
          cloze: lemma,
        },
        {
          lemma,
          pos: 'noun',
          translation: `${lemma}-en`,
          example: `To nie jest to.`,
          cloze: lemma,
        },
      ]);
      return {
        content: [{ type: 'text', text: JSON.stringify(rows) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

async function setup(prompts: string[] = []) {
  const ctx = createTestApp({ modelFactory: () => sentenceModel(prompts) });
  const cookie = await ctx.createUser('a@test.dev');
  const words = [
    { lemma: 'kot', pos: 'noun', translations: ['cat'] },
    { lemma: 'pies', pos: 'noun', translations: ['dog'] },
    {
      lemma: 'dom',
      pos: 'noun',
      translations: ['house'],
      examples: [{ text: 'Mój dom jest duży.', translation: 'My house is big.', cloze: 'dom' }],
    },
  ];
  const theme = (await (
    await ctx.call('/api/themes', { method: 'POST', cookie, body: { name: 'T', words } })
  ).json()) as ThemeSummaryDto;
  return { ...ctx, cookie, theme };
}

describe('example sentences on demand', () => {
  it('builds a prompt for the words without a usable sentence', async () => {
    const ctx = await setup();
    const dto = (await (
      await ctx.call(`/api/themes/${ctx.theme.id}/fill/examples/prompt`, {
        method: 'POST',
        cookie: ctx.cookie,
      })
    ).json()) as FillPromptDto;
    expect(dto.lemmas).toEqual(['kot', 'pies']);
    expect(dto.prompt).toContain('- kot (noun: cat)');
    expect(dto.prompt).not.toContain('- dom');
  });

  it('saves pasted sentences, skipping ones without the word form and other words', async () => {
    const ctx = await setup();
    const raw = JSON.stringify([
      {
        lemma: 'kot',
        pos: 'noun',
        translation: 'cat',
        example: 'Mój kot śpi.',
        example_translation: 'My cat sleeps.',
        cloze: 'kot',
      },
      { lemma: 'kot', pos: 'noun', translation: 'cat', example: 'Nie widzę go.', cloze: 'kotka' },
      { lemma: 'ryba', pos: 'noun', translation: 'fish', example: 'Ryba pływa.', cloze: 'Ryba' },
    ]);
    const res = await ctx.call(`/api/themes/${ctx.theme.id}/fill/examples/import`, {
      method: 'POST',
      cookie: ctx.cookie,
      body: { raw },
    });
    const result = (await res.json()) as FillResultDto;
    expect(result).toMatchObject({ added: 1, words: 1, remaining: 1 });
    expect(result.issues.map((i) => i.lemma)).toEqual(['kot', 'ryba']);
    const kot = ctx.db.select().from(schema.lexemes).where(eq(schema.lexemes.lemma, 'kot')).get();
    expect(
      ctx.db
        .select()
        .from(schema.exampleSentences)
        .where(eq(schema.exampleSentences.lexemeId, kot?.id ?? ''))
        .all(),
    ).toEqual([
      expect.objectContaining({
        text: 'Mój kot śpi.',
        clozeTarget: 'kot',
        source: 'ai',
        translationLang: 'en',
      }),
    ]);
    expect(ctx.db.select().from(schema.aiGenerations).get()).toMatchObject({
      kind: 'example_sentences',
      source: 'manual',
      parsedOk: true,
    });
  });

  it('generates with the user’s API key and logs the generation', async () => {
    const prompts: string[] = [];
    const ctx = await setup(prompts);
    const cred = (await (
      await ctx.call('/api/credentials', {
        method: 'POST',
        cookie: ctx.cookie,
        body: { provider: 'anthropic', label: 'Claude', apiKey: 'sk-ant-test-1234' },
      })
    ).json()) as { id: string };
    const res = await ctx.call(`/api/themes/${ctx.theme.id}/fill/examples/generate`, {
      method: 'POST',
      cookie: ctx.cookie,
      body: { credentialId: cred.id },
    });
    expect(res.status).toBe(200);
    // "To nie jest to." has no "kot"/"pies", so only one sentence per word is kept.
    expect(await res.json()).toMatchObject({ added: 2, words: 2, remaining: 0 });
    expect(prompts).toHaveLength(1);
    expect(ctx.db.select().from(schema.aiGenerations).get()).toMatchObject({
      kind: 'example_sentences',
      source: 'api',
      provider: 'anthropic',
      parsedOk: true,
    });

    // Nothing left to do: no further model call.
    const again = await ctx.call(`/api/themes/${ctx.theme.id}/fill/examples/generate`, {
      method: 'POST',
      cookie: ctx.cookie,
      body: { credentialId: cred.id },
    });
    expect(await again.json()).toMatchObject({ added: 0, remaining: 0 });
    expect(prompts).toHaveLength(1);
  });

  it('keeps other learners out', async () => {
    const ctx = await setup();
    const bob = await ctx.createUser('bob@test.dev');
    const res = await ctx.call(`/api/themes/${ctx.theme.id}/fill/examples/prompt`, {
      method: 'POST',
      cookie: bob,
    });
    expect(res.status).toBe(404);
  });
});

describe('grammar forms on demand', () => {
  it('asks for forms of inflecting words without them and fills only missing ones', async () => {
    const ctx = createTestApp();
    const cookie = await ctx.createUser('a@test.dev');
    const words = [
      { lemma: 'kot', pos: 'noun', translations: ['cat'] },
      { lemma: 'szybko', pos: 'adverb', translations: ['fast'] },
      { lemma: 'dom', pos: 'noun', translations: ['house'], forms: { gen_sg: 'domu' } },
    ];
    const theme = (await (
      await ctx.call('/api/themes', { method: 'POST', cookie, body: { name: 'T', words } })
    ).json()) as ThemeSummaryDto;

    const dto = (await (
      await ctx.call(`/api/themes/${theme.id}/fill/forms/prompt`, { method: 'POST', cookie })
    ).json()) as FillPromptDto;
    expect(dto.lemmas).toEqual(['kot']);
    expect(dto.promptVersion).toBe('grammar-forms@1');
    expect(dto.prompt).toContain('gen_sg, nom_pl, ins_sg');

    const raw = JSON.stringify([
      { lemma: 'kot', pos: 'noun', translation: 'cat', forms: { gen_sg: 'kota', ins_sg: 'kotem' } },
      { lemma: 'dom', pos: 'noun', translation: 'house', forms: { gen_sg: 'WRONG' } },
    ]);
    const result = (await (
      await ctx.call(`/api/themes/${theme.id}/fill/forms/import`, {
        method: 'POST',
        cookie,
        body: { raw },
      })
    ).json()) as FillResultDto;
    expect(result).toMatchObject({ added: 1, words: 1, remaining: 0 });
    const forms = (lemma: string) =>
      ctx.db.select().from(schema.lexemes).where(eq(schema.lexemes.lemma, lemma)).get()?.forms;
    expect(forms('kot')).toEqual({ gen_sg: 'kota', ins_sg: 'kotem' });
    expect(forms('dom')).toEqual({ gen_sg: 'domu' });
    expect(ctx.db.select().from(schema.aiGenerations).get()).toMatchObject({
      kind: 'drill',
      promptVersion: 'grammar-forms@1',
    });
  });

  it('rejects unknown kinds', async () => {
    const ctx = createTestApp();
    const cookie = await ctx.createUser('a@test.dev');
    const res = await ctx.call('/api/themes/x/fill/pictures/prompt', { method: 'POST', cookie });
    expect(res.status).toBe(400);
  });
});
