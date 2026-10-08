import { schema } from '@alivocab/db';
import { describe, expect, it, vi } from 'vitest';
import { createTestApp } from './helpers.ts';

describe('profile', () => {
  it('updates appearance and learning settings', async () => {
    const { call, createUser } = createTestApp();
    const cookie = await createUser('a@test.dev');
    const res = await call('/api/me/profile', {
      method: 'PATCH',
      cookie,
      body: { colorPalette: 'pl', colorMode: 'dark', nativeLang: 'pt', defaultWordCount: 50 },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      colorPalette: 'pl',
      colorMode: 'dark',
      nativeLang: 'pt',
      defaultWordCount: 50,
    });
  });

  it.each([
    [{ colorPalette: 'neon' }],
    [{ colorMode: 'sepia' }],
    [{ targetLang: 'polish' }],
    [{ defaultWordCount: 1000 }],
    [{}],
  ])('rejects invalid patch %j', async (body) => {
    const { call, createUser } = createTestApp();
    const cookie = await createUser('a@test.dev');
    expect((await call('/api/me/profile', { method: 'PATCH', cookie, body })).status).toBe(400);
  });

  it('only accepts own credentials as default AI source', async () => {
    const { call, createUser } = createTestApp();
    const alice = await createUser('alice@test.dev');
    const bob = await createUser('bob@test.dev');
    const cred = (await (
      await call('/api/credentials', {
        method: 'POST',
        cookie: alice,
        body: { provider: 'openai', label: 'Mine', apiKey: 'sk-alice-123456' },
      })
    ).json()) as { id: string };

    const ok = await call('/api/me/profile', {
      method: 'PATCH',
      cookie: alice,
      body: { defaultAiSource: `api:${cred.id}` },
    });
    expect(ok.status).toBe(200);
    const stolen = await call('/api/me/profile', {
      method: 'PATCH',
      cookie: bob,
      body: { defaultAiSource: `api:${cred.id}` },
    });
    expect(stolen.status).toBe(400);
  });
});

describe('AI credentials', () => {
  it('stores keys encrypted and never returns them', async () => {
    const { call, createUser, db } = createTestApp();
    const cookie = await createUser('a@test.dev');
    const res = await call('/api/credentials', {
      method: 'POST',
      cookie,
      body: { provider: 'anthropic', label: 'Claude', apiKey: 'sk-ant-supersecret-WXYZ' },
    });
    expect(res.status).toBe(201);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('supersecret');
    expect(body).toContain('"keyLast4":"WXYZ"');

    const row = db.select().from(schema.aiCredentials).get();
    expect(row?.keyCiphertext).not.toContain('supersecret');

    const list = JSON.stringify(await (await call('/api/credentials', { cookie })).json());
    expect(list).not.toContain('supersecret');
  });

  it('isolates credentials between users', async () => {
    const { call, createUser } = createTestApp();
    const alice = await createUser('alice@test.dev');
    const bob = await createUser('bob@test.dev');
    const created = (await (
      await call('/api/credentials', {
        method: 'POST',
        cookie: alice,
        body: { provider: 'openai', label: 'Mine', apiKey: 'sk-alice-123456' },
      })
    ).json()) as { id: string };

    expect(await (await call('/api/credentials', { cookie: bob })).json()).toEqual([]);
    for (const [method, path] of [
      ['PATCH', `/api/credentials/${created.id}`],
      ['DELETE', `/api/credentials/${created.id}`],
      ['POST', `/api/credentials/${created.id}/test`],
    ] as const) {
      const res = await call(path, {
        method,
        cookie: bob,
        body: method === 'PATCH' ? { label: 'x' } : undefined,
      });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(await (await call('/api/credentials', { cookie: alice })).json()).toHaveLength(1);
  });

  it('tests a saved credential with the decrypted key', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => Response.json({ data: [{ id: 'gpt-x' }] }));
    const { call, createUser } = createTestApp({ fetchFn });
    const cookie = await createUser('a@test.dev');
    const { id } = (await (
      await call('/api/credentials', {
        method: 'POST',
        cookie,
        body: { provider: 'openai', label: 'Mine', apiKey: 'sk-real-key-9876' },
      })
    ).json()) as { id: string };

    const res = await call(`/api/credentials/${id}/test`, { method: 'POST', cookie });
    expect(await res.json()).toMatchObject({ ok: true, models: ['gpt-x'] });
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer sk-real-key-9876' });

    const [listed] = (await (await call('/api/credentials', { cookie })).json()) as Array<{
      lastTestOk: boolean;
    }>;
    expect(listed?.lastTestOk).toBe(true);
  });

  it('blocks private base URLs when not allowed', async () => {
    const { call, createUser } = createTestApp({ allowPrivateAiBaseUrls: false });
    const cookie = await createUser('a@test.dev');
    const res = await call('/api/credentials', {
      method: 'POST',
      cookie,
      body: { provider: 'openai_compat', label: 'Local', baseUrl: 'http://127.0.0.1:11434/v1' },
    });
    expect(res.status).toBe(400);
  });

  it('requires a key for hosted providers but not for OpenAI-compatible endpoints', async () => {
    const { call, createUser } = createTestApp({ allowPrivateAiBaseUrls: true });
    const cookie = await createUser('a@test.dev');
    const noKey = await call('/api/credentials', {
      method: 'POST',
      cookie,
      body: { provider: 'anthropic', label: 'Claude' },
    });
    expect(noKey.status).toBe(400);
    const compat = await call('/api/credentials', {
      method: 'POST',
      cookie,
      body: { provider: 'openai_compat', label: 'Local', baseUrl: 'http://127.0.0.1:11434/v1/' },
    });
    expect(compat.status).toBe(201);
    expect(await compat.json()).toMatchObject({
      baseUrl: 'http://127.0.0.1:11434/v1',
      keyLast4: '',
    });
  });

  it('resets the default AI source when its credential is deleted', async () => {
    const { call, createUser } = createTestApp();
    const cookie = await createUser('a@test.dev');
    const { id } = (await (
      await call('/api/credentials', {
        method: 'POST',
        cookie,
        body: { provider: 'deepseek', label: 'DS', apiKey: 'sk-deepseek-1234' },
      })
    ).json()) as { id: string };
    await call('/api/me/profile', {
      method: 'PATCH',
      cookie,
      body: { defaultAiSource: `api:${id}` },
    });
    expect((await call(`/api/credentials/${id}`, { method: 'DELETE', cookie })).status).toBe(204);
    const me = (await (await call('/api/me', { cookie })).json()) as {
      profile: { defaultAiSource: string };
    };
    expect(me.profile.defaultAiSource).toBe('manual');
  });
});
