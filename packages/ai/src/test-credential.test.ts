import { describe, expect, it, vi } from 'vitest';
import { testCredential } from './test-credential.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('testCredential', () => {
  it('lists Anthropic models with the right headers', async () => {
    const fetchFn = vi.fn(async () => json({ data: [{ id: 'claude-b' }, { id: 'claude-a' }] }));
    const res = await testCredential({ provider: 'anthropic', apiKey: 'sk-ant-x' }, fetchFn);
    expect(res).toMatchObject({ ok: true, models: ['claude-a', 'claude-b'] });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('api.anthropic.com/v1/models');
    expect(init.headers).toMatchObject({ 'x-api-key': 'sk-ant-x' });
  });

  it('reports a rejected key', async () => {
    const fetchFn = vi.fn(async () => json({ error: 'nope' }, 401));
    const res = await testCredential({ provider: 'openai', apiKey: 'sk-bad' }, fetchFn);
    expect(res).toEqual({ ok: false, message: 'The provider rejected this API key', models: [] });
  });

  it('keeps only Gemini models that support generateContent', async () => {
    const fetchFn = vi.fn(async () =>
      json({
        models: [
          { name: 'models/gemini-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] },
        ],
      }),
    );
    const res = await testCredential({ provider: 'google', apiKey: 'AIza-x' }, fetchFn);
    expect(res.models).toEqual(['gemini-flash']);
  });

  it('validates OpenRouter keys before listing public models', async () => {
    const fetchFn = vi.fn(async () => json({}, 401));
    const res = await testCredential({ provider: 'openrouter', apiKey: 'sk-or-bad' }, fetchFn);
    expect(res.ok).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('uses the base URL for OpenAI-compatible endpoints, key optional', async () => {
    const fetchFn = vi.fn(async () => json({ data: [{ id: 'llama3' }] }));
    const res = await testCredential(
      { provider: 'openai_compat', apiKey: '', baseUrl: 'http://example.test/v1' },
      fetchFn,
    );
    expect(res.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://example.test/v1/models');
    expect(init.headers).toEqual({});
  });

  it('handles network failures', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const res = await testCredential({ provider: 'deepseek', apiKey: 'sk-x' }, fetchFn);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('ECONNREFUSED');
  });
});
