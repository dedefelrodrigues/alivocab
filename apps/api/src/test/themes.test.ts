import { schema } from '@alivocab/db';
import type { ProposalDto, ThemeDetailDto, ThemeSummaryDto } from '@alivocab/shared';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.ts';

const w = (lemma: string, extra: Record<string, unknown> = {}) => ({
  lemma,
  pos: 'noun',
  translations: [`${lemma}-en`],
  ...extra,
});

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

/** A fake model that answers each call with `n` new words (n parsed from the prompt). */
function fakeModel() {
  let next = 0;
  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const text = JSON.stringify(prompt);
      const n = Number(/Exactly (\d+) distinct/.exec(text)?.[1] ?? 1);
      const words = Array.from({ length: n }, () => w(`słowo${next++}`));
      return {
        content: [{ type: 'text', text: JSON.stringify({ words }) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

async function json<T>(res: Response | Promise<Response>): Promise<T> {
  return (await (await res).json()) as T;
}

describe('themes and import', () => {
  it('imports pasted output, saves a theme with tags and returns details', async () => {
    const { call, createUser } = createTestApp();
    const cookie = await createUser('a@test.dev');
    const raw = JSON.stringify({
      words: [
        w('chleb', {
          gender: 'm',
          examples: [{ text: 'Kupiłem chleb.', translation: 'I bought bread.', cloze: 'chleb' }],
        }),
        w('masło', { gender: 'n' }),
      ],
    });

    const proposal = await json<ProposalDto>(
      call('/api/generate/import', {
        method: 'POST',
        cookie,
        body: { raw, source: 'manual', themeName: 'Bakery' },
      }),
    );
    expect(proposal.words.map((x) => [x.lemma, x.existing])).toEqual([
      ['chleb', null],
      ['masło', null],
    ]);

    const created = await call('/api/themes', {
      method: 'POST',
      cookie,
      body: {
        name: 'Piekarnia & café',
        generationId: proposal.generationId,
        words: [
          { ...proposal.words[0], status: 'known' },
          { ...proposal.words[1], status: 'unknown' },
        ],
      },
    });
    expect(created.status).toBe(201);
    const summary = (await created.json()) as ThemeSummaryDto;
    expect(summary).toMatchObject({
      slug: 'piekarnia-cafe',
      wordCount: 2,
      counts: { known: 1, unknown: 1, recognize: 0, untagged: 0 },
    });

    const detail = await json<ThemeDetailDto>(call(`/api/themes/${summary.id}`, { cookie }));
    expect(detail.words[0]).toMatchObject({
      lemma: 'chleb',
      gender: 'm',
      status: 'known',
      translations: ['chleb-en'],
      examples: [{ text: 'Kupiłem chleb.', translation: 'I bought bread.', cloze: 'chleb' }],
      editable: true,
    });
  });

  it('links an existing word to a new theme instead of duplicating it', async () => {
    const { call, createUser, db } = createTestApp();
    const cookie = await createUser('a@test.dev');
    const first = await json<ThemeSummaryDto>(
      call('/api/themes', {
        method: 'POST',
        cookie,
        body: { name: 'Food', words: [{ ...w('chleb'), status: 'recognize' }] },
      }),
    );
    await call('/api/themes', {
      method: 'POST',
      cookie,
      body: {
        name: 'Breakfast',
        words: [
          { ...w('Chleb'), status: 'untagged' },
          { ...w('jajko'), status: 'unknown' },
        ],
      },
    });

    expect(db.select().from(schema.lexemes).all()).toHaveLength(2);
    expect(db.select().from(schema.themeLexemes).all()).toHaveLength(3);
    // An untagged re-save keeps the earlier tag.
    expect(
      db
        .select()
        .from(schema.userLexemes)
        .all()
        .find((u) => u.status === 'recognize'),
    ).toBeTruthy();

    const proposal = await json<ProposalDto>(
      call('/api/generate/import', {
        method: 'POST',
        cookie,
        body: { raw: 'chleb – bread\nmleko – milk', source: 'manual', themeId: first.id },
      }),
    );
    const chleb = proposal.words.find((x) => x.lemma === 'chleb');
    expect(chleb?.existing?.status).toBe('recognize');
    expect(chleb?.existing?.themes.map((t) => t.name).sort()).toEqual(['Breakfast', 'Food']);
    expect(chleb?.inTheme).toBe(true);
    expect(proposal.words.find((x) => x.lemma === 'mleko')?.existing).toBeNull();
  });

  it('shares the dictionary but keeps tags private, and guards shared edits', async () => {
    const { call, createUser, db } = createTestApp();
    const alice = await createUser('alice@test.dev');
    const bob = await createUser('bob@test.dev');

    await call('/api/themes', {
      method: 'POST',
      cookie: alice,
      body: { name: 'A', words: [{ ...w('kot'), status: 'known' }] },
    });
    // Bob adds the same word with extra data: gaps are filled, nothing is overwritten.
    await call('/api/themes', {
      method: 'POST',
      cookie: bob,
      body: {
        name: 'B',
        words: [{ ...w('kot', { gender: 'm', pronunciation: 'kɔt' }), status: 'unknown' }],
      },
    });
    const lexemes = db.select().from(schema.lexemes).all();
    expect(lexemes).toHaveLength(1);
    expect(lexemes[0]).toMatchObject({ gender: 'm', pronunciation: 'kɔt' });

    const [aliceTheme] = await json<ThemeSummaryDto[]>(call('/api/themes', { cookie: alice }));
    const detail = await json<ThemeDetailDto>(
      call(`/api/themes/${aliceTheme?.id}`, { cookie: alice }),
    );
    expect(detail.words[0]).toMatchObject({ status: 'known', editable: false });

    const lexemeId = lexemes[0]?.id;
    const shared = await call(`/api/words/${lexemeId}`, {
      method: 'PATCH',
      cookie: alice,
      body: { gender: 'f' },
    });
    expect(shared.status).toBe(403);
    const personal = await call(`/api/words/${lexemeId}`, {
      method: 'PATCH',
      cookie: alice,
      body: { note: 'sounds like "cot"', mnemonic: 'cat → kot' },
    });
    expect(personal.status).toBe(200);
  });

  it('lets the sole user edit shared fields and translations', async () => {
    const { call, createUser } = createTestApp();
    const cookie = await createUser('a@test.dev');
    const theme = await json<ThemeSummaryDto>(
      call('/api/themes', { method: 'POST', cookie, body: { name: 'T', words: [w('zupa')] } }),
    );
    const detail = await json<ThemeDetailDto>(call(`/api/themes/${theme.id}`, { cookie }));
    const id = detail.words[0]?.lexemeId;
    const res = await call(`/api/words/${id}`, {
      method: 'PATCH',
      cookie,
      body: { gender: 'f', translations: ['soup', 'broth'] },
    });
    expect(res.status).toBe(200);
    const after = await json<ThemeDetailDto>(call(`/api/themes/${theme.id}`, { cookie }));
    expect(after.words[0]).toMatchObject({ gender: 'f', translations: ['soup', 'broth'] });

    await call(`/api/words/${id}/status`, {
      method: 'PATCH',
      cookie,
      body: { status: 'recognize' },
    });
    const tagged = await json<ThemeDetailDto>(call(`/api/themes/${theme.id}`, { cookie }));
    expect(tagged.counts.recognize).toBe(1);
  });

  it('adds and unlinks words, and deleting a theme keeps the dictionary', async () => {
    const { call, createUser, db } = createTestApp();
    const cookie = await createUser('a@test.dev');
    const theme = await json<ThemeSummaryDto>(
      call('/api/themes', { method: 'POST', cookie, body: { name: 'T' } }),
    );
    const added = await json<{ added: number; linked: number }>(
      call(`/api/themes/${theme.id}/words`, {
        method: 'POST',
        cookie,
        body: { words: [w('a'), w('b')] },
      }),
    );
    expect(added).toMatchObject({ added: 2, linked: 2 });

    const detail = await json<ThemeDetailDto>(call(`/api/themes/${theme.id}`, { cookie }));
    await call(`/api/themes/${theme.id}/words/${detail.words[0]?.lexemeId}`, {
      method: 'DELETE',
      cookie,
    });
    expect(
      (await json<ThemeDetailDto>(call(`/api/themes/${theme.id}`, { cookie }))).wordCount,
    ).toBe(1);

    expect((await call(`/api/themes/${theme.id}`, { method: 'DELETE', cookie })).status).toBe(204);
    expect(db.select().from(schema.themeLexemes).all()).toHaveLength(0);
    expect(db.select().from(schema.userLexemes).all()).toHaveLength(2);
  });

  it('isolates themes and generations between users', async () => {
    const { call, createUser } = createTestApp();
    const alice = await createUser('alice@test.dev');
    const bob = await createUser('bob@test.dev');
    const theme = await json<ThemeSummaryDto>(
      call('/api/themes', { method: 'POST', cookie: alice, body: { name: 'Secret' } }),
    );
    const proposal = await json<ProposalDto>(
      call('/api/generate/import', {
        method: 'POST',
        cookie: alice,
        body: { raw: 'a – b', source: 'manual' },
      }),
    );

    expect((await call(`/api/themes/${theme.id}`, { cookie: bob })).status).toBe(404);
    expect(
      (
        await call(`/api/themes/${theme.id}/words`, {
          method: 'POST',
          cookie: bob,
          body: { words: [w('x')] },
        })
      ).status,
    ).toBe(404);
    expect((await call(`/api/themes/${theme.id}`, { method: 'DELETE', cookie: bob })).status).toBe(
      404,
    );
    expect(
      (
        await call('/api/themes', {
          method: 'POST',
          cookie: bob,
          body: { name: 'X', generationId: proposal.generationId },
        })
      ).status,
    ).toBe(400);
    expect(await json<unknown[]>(call('/api/themes', { cookie: bob }))).toEqual([]);
    expect(
      (
        await call('/api/generate/prompt', {
          method: 'POST',
          cookie: bob,
          body: { themeName: 'x', count: 10, themeId: theme.id },
        })
      ).status,
    ).toBe(404);
  });

  it('builds the prompt with the theme words as avoid list', async () => {
    const { call, createUser } = createTestApp();
    const cookie = await createUser('a@test.dev');
    const theme = await json<ThemeSummaryDto>(
      call('/api/themes', { method: 'POST', cookie, body: { name: 'T', words: [w('chleb')] } }),
    );
    const { prompt, avoid } = await json<{ prompt: string; avoid: string[] }>(
      call('/api/generate/prompt', {
        method: 'POST',
        cookie,
        body: { themeName: 'Bakery', count: 20, level: 'A2', themeId: theme.id, format: 'csv' },
      }),
    );
    expect(avoid).toEqual(['chleb']);
    expect(prompt).toContain('Exactly 20 distinct items');
    expect(prompt).toContain('lemma;translation;pos');
  });
});

describe('server-side generation', () => {
  it('generates in batches with the user key and logs the generation', async () => {
    const calls: Array<{ provider: string; apiKey: string; model?: string | null }> = [];
    const { call, createUser, db } = createTestApp({
      modelFactory: (input) => {
        calls.push(input);
        return fakeModel();
      },
    });
    const cookie = await createUser('a@test.dev');
    const cred = await json<{ id: string }>(
      call('/api/credentials', {
        method: 'POST',
        cookie,
        body: { provider: 'anthropic', label: 'Claude', apiKey: 'sk-ant-test-1234' },
      }),
    );

    const proposal = await json<ProposalDto>(
      call('/api/generate', {
        method: 'POST',
        cookie,
        body: { themeName: 'Bakery', count: 30, credentialId: cred.id },
      }),
    );
    expect(proposal.words).toHaveLength(30);
    expect(calls[0]).toMatchObject({
      provider: 'anthropic',
      apiKey: 'sk-ant-test-1234',
      model: 'claude-sonnet-5-5',
    });

    const [gen] = db.select().from(schema.aiGenerations).all();
    expect(gen).toMatchObject({
      source: 'api',
      provider: 'anthropic',
      parsedOk: true,
      tokensIn: 20,
      tokensOut: 40,
    });
    expect(gen?.prompt.split('---')).toHaveLength(2);
  });

  it('requires a model for providers without a default', async () => {
    const { call, createUser } = createTestApp({ modelFactory: () => fakeModel() });
    const cookie = await createUser('a@test.dev');
    const cred = await json<{ id: string }>(
      call('/api/credentials', {
        method: 'POST',
        cookie,
        body: { provider: 'openai', label: 'OAI', apiKey: 'sk-test-12345' },
      }),
    );
    const res = await call('/api/generate', {
      method: 'POST',
      cookie,
      body: { themeName: 'x', count: 5, credentialId: cred.id },
    });
    expect(res.status).toBe(400);
    const ok = await call('/api/generate', {
      method: 'POST',
      cookie,
      body: { themeName: 'x', count: 5, credentialId: cred.id, model: 'gpt-test' },
    });
    expect(ok.status).toBe(200);
  });

  it('reports provider failures as 502 with a readable message', async () => {
    const failing = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('connection reset');
      },
    });
    const { call, createUser, db } = createTestApp({ modelFactory: () => failing });
    const cookie = await createUser('a@test.dev');
    const cred = await json<{ id: string }>(
      call('/api/credentials', {
        method: 'POST',
        cookie,
        body: { provider: 'google', label: 'G', apiKey: 'AIza-test-123' },
      }),
    );
    const res = await call('/api/generate', {
      method: 'POST',
      cookie,
      body: { themeName: 'x', count: 5, credentialId: cred.id },
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'connection reset' });
    expect(db.select().from(schema.aiGenerations).get()).toMatchObject({
      parsedOk: false,
      error: 'connection reset',
    });
  });
});
