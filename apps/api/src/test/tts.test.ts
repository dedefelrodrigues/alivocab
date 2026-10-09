import type { LogPageDto, MeDto, TtsResultDto } from '@alivocab/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AppDeps } from '../types.ts';
import { createTestApp } from './helpers.ts';

function setup() {
  const synthesizeFn = vi.fn<NonNullable<AppDeps['synthesizeFn']>>(async () => ({
    audio: new Uint8Array([73, 68, 51, 1, 2, 3]),
    mediaType: 'audio/mpeg',
  }));
  const ctx = createTestApp({ synthesizeFn });
  return { ...ctx, synthesizeFn };
}

const say = (
  ctx: Pick<ReturnType<typeof createTestApp>, 'call'>,
  cookie: string,
  body: Record<string, unknown>,
) => ctx.call('/api/tts', { method: 'POST', cookie, body });

describe('cloud pronunciation', () => {
  it('uses Gemini by default and falls back to Edge without a key', async () => {
    const ctx = setup();
    const cookie = await ctx.createUser('a@test.dev');
    const me = (await (await ctx.call('/api/me', { cookie })).json()) as MeDto;
    expect(me.profile.ttsProvider).toBe('google');

    const res = await say(ctx, cookie, { text: 'kot', lang: 'pl' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      provider: 'edge',
      fallback: { from: 'google', reason: 'needs your API key (Settings → AI providers).' },
    });
    expect(ctx.synthesizeFn.mock.calls.map((c) => [c[0].provider, c[0].voice])).toEqual([
      ['edge', 'pl-PL-ZofiaNeural'],
    ]);
    const log = (await (await ctx.call('/api/logs?category=app', { cookie })).json()) as LogPageDto;
    expect(log.entries[0]?.message).toBe(
      'Pronunciation: Google Gemini didn’t work, used Microsoft Edge',
    );

    // Browser voices are spoken by the web app itself.
    await ctx.call('/api/me/profile', {
      method: 'PATCH',
      cookie,
      body: { ttsProvider: 'browser' },
    });
    const browser = await say(ctx, cookie, { text: 'kot', lang: 'pl' });
    expect(browser.status).toBe(400);
    expect(((await browser.json()) as { error: string }).error).toMatch(/browser’s voices/);
  });

  it('falls back to Edge when Gemini fails, skips Gemini for a while, and gives up after Edge', async () => {
    let edgeWorks = true;
    const synthesizeFn = vi.fn<NonNullable<AppDeps['synthesizeFn']>>(async ({ provider }) => {
      if (provider === 'google') throw new Error('quota exceeded');
      if (!edgeWorks) throw new Error('Edge is down');
      return { audio: new Uint8Array([1, 2, 3]), mediaType: 'audio/mpeg' };
    });
    const ctx = createTestApp({ synthesizeFn });
    const cookie = await ctx.createUser('a@test.dev');
    await ctx.call('/api/credentials', {
      method: 'POST',
      cookie,
      body: { provider: 'google', label: 'Gemini', apiKey: 'AIza-test-key-1234' },
    });

    // A dialogue's second speaker gets Edge's second voice, so the two still sound different.
    const first = await say(ctx, cookie, { text: 'Dzień dobry', lang: 'pl', voice: 'Puck' });
    expect(await first.json()).toMatchObject({
      provider: 'edge',
      fallback: { from: 'google', reason: 'quota exceeded' },
    });
    await say(ctx, cookie, { text: 'Cześć', lang: 'pl' });
    expect(synthesizeFn.mock.calls.map((c) => [c[0].provider, c[0].voice])).toEqual([
      ['google', 'Puck'],
      ['edge', 'pl-PL-MarekNeural'],
      // Gemini just failed: not asked again for a few minutes.
      ['edge', 'pl-PL-ZofiaNeural'],
    ]);

    edgeWorks = false;
    const res = await say(ctx, cookie, { text: 'Do widzenia', lang: 'pl' });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe(
      'Google Gemini: failed a moment ago, skipped for a few minutes. Microsoft Edge: Edge is down',
    );
  });

  it('speaks with the learner’s key and voice, and caches the audio', async () => {
    const ctx = setup();
    const cookie = await ctx.createUser('a@test.dev');
    await ctx.call('/api/credentials', {
      method: 'POST',
      cookie,
      body: { provider: 'openai', label: 'OpenAI', apiKey: 'sk-test-openai-1234' },
    });
    await ctx.call('/api/me/profile', {
      method: 'PATCH',
      cookie,
      body: { ttsProvider: 'openai', ttsVoice: 'nova' },
    });

    const first = (await (
      await say(ctx, cookie, { text: ' Dzień  dobry ', lang: 'pl' })
    ).json()) as TtsResultDto;
    expect(first.url).toMatch(/^\/api\/tts\/audio\/[a-f0-9]{64}$/);
    expect(ctx.synthesizeFn).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'sk-test-openai-1234',
      text: 'Dzień dobry',
      lang: 'pl',
      voice: 'nova',
    });

    // Same text (after normalizing) → cached, no second paid call.
    const again = (await (
      await say(ctx, cookie, { text: 'Dzień dobry', lang: 'pl' })
    ).json()) as TtsResultDto;
    expect(again.url).toBe(first.url);
    expect(ctx.synthesizeFn).toHaveBeenCalledTimes(1);

    // A dialogue's second speaker uses another voice → another clip; unknown voices fall back.
    await say(ctx, cookie, { text: 'Dzień dobry', lang: 'pl', voice: 'onyx' });
    await say(ctx, cookie, { text: 'Cześć', lang: 'pl', voice: 'not-a-voice' });
    expect(ctx.synthesizeFn.mock.calls.map((c) => c[0].voice)).toEqual(['nova', 'onyx', 'coral']);

    const audio = await ctx.call(first.url, { cookie });
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toBe('audio/mpeg');
    expect([...new Uint8Array(await audio.arrayBuffer())]).toEqual([73, 68, 51, 1, 2, 3]);
  });

  it('serves audio only to signed-in users and rejects odd hashes', async () => {
    const ctx = setup();
    const cookie = await ctx.createUser('a@test.dev');
    expect((await ctx.call(`/api/tts/audio/${'a'.repeat(64)}`)).status).toBe(401);
    expect((await ctx.call('/api/tts/audio/..%2F..%2F.env', { cookie })).status).toBe(404);
  });

  it('speaks with Microsoft Edge voices without a key, one voice set per language', async () => {
    const ctx = setup();
    const cookie = await ctx.createUser('a@test.dev');
    await ctx.call('/api/me/profile', {
      method: 'PATCH',
      cookie,
      body: { ttsProvider: 'edge', ttsVoice: 'pl-PL-MarekNeural' },
    });
    expect((await say(ctx, cookie, { text: 'Dzień dobry', lang: 'pl' })).status).toBe(200);
    // The Polish voice can't read Portuguese: that language's default is used instead.
    expect((await say(ctx, cookie, { text: 'Bom dia', lang: 'pt' })).status).toBe(200);
    expect(
      ctx.synthesizeFn.mock.calls.map((c) => [c[0].provider, c[0].voice, c[0].apiKey]),
    ).toEqual([
      ['edge', 'pl-PL-MarekNeural', ''],
      ['edge', 'pt-BR-FranciscaNeural', ''],
    ]);

    const res = await say(ctx, cookie, { text: 'Hyvää päivää', lang: 'fi' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('Microsoft Edge: no FI voice.');
  });

  it('reports provider errors', async () => {
    const ctx = createTestApp({
      synthesizeFn: async () => {
        throw new Error('quota exceeded');
      },
    });
    const cookie = await ctx.createUser('a@test.dev');
    await ctx.call('/api/credentials', {
      method: 'POST',
      cookie,
      body: { provider: 'google', label: 'Gemini', apiKey: 'AIza-test-key-1234' },
    });
    await ctx.call('/api/me/profile', { method: 'PATCH', cookie, body: { ttsProvider: 'google' } });
    const res = await ctx.call('/api/tts', {
      method: 'POST',
      cookie,
      body: { text: 'kot', lang: 'pl' },
    });
    expect(res.status).toBe(502);
  });
});
