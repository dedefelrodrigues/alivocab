import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schema } from '@alivocab/db';
import type { PictureDto, ReviewQueueDto, ThemeDetailDto, ThemeSummaryDto } from '@alivocab/shared';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { createPictureService } from '../lib/pictures/service.ts';
import { createPictureStore } from '../lib/pictures/store.ts';
import { createTestApp } from './helpers.ts';

const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#e0a040' } })
  .png()
  .toBuffer();

/** Public IP literals avoid DNS lookups while still passing the SSRF guard. */
const IMG = (name: string) => `https://93.184.215.14/${name}.png`;

type Route = {
  calls: string[];
  fetchFn: typeof fetch;
  userAgents?: string[];
  /** Most Wikimedia requests that were in flight at the same time. */
  maxCommonsInFlight?: () => number;
};

/**
 * Fake Openverse + Wikimedia Commons + image host. `results` maps a query to the Openverse ids
 * it returns, `opts.commons` maps a query to Commons page ids. Commons finds nothing otherwise.
 */
function fakeWeb(
  results: Record<string, string[]>,
  opts: {
    privateUrl?: boolean;
    limited?: boolean;
    commons?: Record<string, number[]>;
    /** Openverse searches time out this many times before answering. */
    openverseTimeouts?: number;
    /** Commons answers 429 this many times, with this Retry-After (seconds). */
    commonsLimited?: { times: number; retryAfter: string };
    /** Commons answers after this delay, to observe concurrency. */
    commonsDelayMs?: number;
  } = {},
): Route {
  let timeouts = opts.openverseTimeouts ?? 0;
  let commonsLimits = opts.commonsLimited?.times ?? 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const userAgents: string[] = [];
  const page = (pageid: number) => ({
    pageid,
    title: `File:Commons photo ${pageid}.jpg`,
    imageinfo: [
      {
        url: IMG(`commons-${pageid}-full`),
        thumburl: IMG(`commons-${pageid}`),
        width: 1600,
        height: 1200,
        mime: 'image/jpeg',
        descriptionurl: `https://commons.wikimedia.org/wiki/File:Commons_photo_${pageid}.jpg`,
        extmetadata: {
          Artist: {
            value:
              '<a href="//commons.wikimedia.org/wiki/User:Jan" title="User:Jan">Jan K&amp;owalski</a>',
          },
          LicenseShortName: { value: 'CC BY-SA 4.0' },
          LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
        },
      },
    ],
  });
  const calls: string[] = [];
  const hit = (id: string) => ({
    id,
    title: `photo ${id}`,
    url: opts.privateUrl ? 'http://127.0.0.1/secret.png' : IMG(id),
    thumbnail: `https://api.openverse.org/v1/images/${id}/thumb/`,
    creator: 'Ann Photographer',
    creator_url: 'https://example.org/ann',
    license: 'by',
    license_version: '2.0',
    license_url: 'https://creativecommons.org/licenses/by/2.0/',
    foreign_landing_url: `https://example.org/photo/${id}`,
    width: 800,
    height: 600,
  });
  const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    userAgents.push(new Headers(init?.headers).get('user-agent') ?? '');
    if (url.startsWith('https://commons.wikimedia.org/w/api.php?')) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (opts.commonsDelayMs) await new Promise((r) => setTimeout(r, opts.commonsDelayMs));
      } finally {
        inFlight--;
      }
      if (commonsLimits > 0) {
        commonsLimits--;
        return new Response('too many', {
          status: 429,
          headers: { 'retry-after': opts.commonsLimited?.retryAfter ?? '1' },
        });
      }
      const params = new URL(url).searchParams;
      const ids = params.has('pageids')
        ? [Number(params.get('pageids'))]
        : (opts.commons?.[(params.get('gsrsearch') ?? '').replace(/ filetype:bitmap$/, '')] ?? []);
      return Response.json({ query: { pages: ids.map(page) } });
    }
    if (url.startsWith('https://api.openverse.org/v1/images/?')) {
      if (opts.limited) return new Response('slow down', { status: 429 });
      if (timeouts > 0) {
        timeouts--;
        throw Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError',
        });
      }
      const q = new URL(url).searchParams.get('q') ?? '';
      return Response.json({ results: (results[q] ?? []).map(hit) });
    }
    const single = /api\.openverse\.org\/v1\/images\/([\w-]+)\/$/.exec(url);
    if (single?.[1]) return Response.json(hit(single[1]));
    if (url.startsWith('https://93.184.215.14/')) {
      return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
    }
    return new Response('not found', { status: 404 });
  });
  return { calls, fetchFn, userAgents, maxCommonsInFlight: () => maxInFlight };
}

const word = (lemma: string, extra: Record<string, unknown> = {}) => ({
  lemma,
  pos: 'noun',
  translations: [`${lemma}-en`],
  status: 'unknown',
  ...extra,
});

async function json<T>(res: Response | Promise<Response>): Promise<T> {
  return (await (await res).json()) as T;
}

async function setupWith(web: Route, words: ReturnType<typeof word>[]) {
  const ctx = createTestApp({ fetchFn: web.fetchFn });
  const cookie = await ctx.createUser('a@test.dev');
  const theme = await json<ThemeSummaryDto>(
    ctx.call('/api/themes', { method: 'POST', cookie, body: { name: 'Bakery', words } }),
  );
  await ctx.deps.pictures.idle();
  const detail = () => json<ThemeDetailDto>(ctx.call(`/api/themes/${theme.id}`, { cookie }));
  return { ...ctx, cookie, theme, detail };
}

describe('automatic pictures', () => {
  it('picks a picture for new words using the AI search phrase', async () => {
    const web = fakeWeb({ 'loaf of bread': ['ov-bread-1'] });
    const { detail, call, cookie, db } = await setupWith(web, [
      word('chleb', { imageQuery: 'loaf of bread' }),
    ]);

    const [w] = (await detail()).words;
    expect(w?.image).toMatchObject({
      provider: 'openverse',
      creator: 'Ann Photographer',
      license: 'CC BY 2.0',
      sourceUrl: 'https://example.org/photo/ov-bread-1',
    });
    expect(w?.image?.width).toBe(480);
    expect(db.select().from(schema.lexemes).get()?.imageSearchedAt).toBeInstanceOf(Date);

    const file = await call(w?.image?.url ?? '', { cookie });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/webp');
    expect((await sharp(Buffer.from(await file.arrayBuffer())).metadata()).format).toBe('webp');
    const thumb = await sharp(
      Buffer.from(await (await call(w?.image?.thumbUrl ?? '', { cookie })).arrayBuffer()),
    ).metadata();
    expect([thumb.width, thumb.height]).toEqual([96, 96]);
  });

  it('skips words the AI marked as not picturable, and falls back to the translation for nouns', async () => {
    const web = fakeWeb({ 'masło-en': ['ov-butter'] });
    const { detail } = await setupWith(web, [
      word('jednak', { pos: 'conjunction', imageQuery: '' }),
      word('masło'),
      word('szybko', { pos: 'adverb' }),
    ]);
    const searches = web.calls.filter((u) => u.includes('/v1/images/?'));
    expect(searches.map((u) => new URL(u).searchParams.get('q'))).toEqual(['masło-en']);
    const words = (await detail()).words;
    expect(words.map((x) => [x.lemma, !!x.image])).toEqual([
      ['jednak', false],
      ['masło', true],
      ['szybko', false],
    ]);
  });

  it('respects the auto-pictures setting', async () => {
    const web = fakeWeb({ bread: ['x'] });
    const ctx = createTestApp({ fetchFn: web.fetchFn });
    const cookie = await ctx.createUser('a@test.dev');
    await ctx.call('/api/me/profile', { method: 'PATCH', cookie, body: { autoPictures: false } });
    await ctx.call('/api/themes', {
      method: 'POST',
      cookie,
      body: { name: 'T', words: [word('chleb', { imageQuery: 'bread' })] },
    });
    await ctx.deps.pictures.idle();
    expect(web.calls).toEqual([]);
  });

  it('leaves words unsearched when the provider is rate-limited, so they can be retried', async () => {
    const web = fakeWeb({}, { limited: true });
    const { db } = await setupWith(web, [word('chleb', { imageQuery: 'bread' })]);
    expect(db.select().from(schema.lexemes).get()).toMatchObject({
      imageId: null,
      imageSearchedAt: null,
    });
  });
});

describe('choosing, uploading and hiding pictures', () => {
  it('searches, then stores the chosen picture as personal choice and shared default', async () => {
    const web = fakeWeb({ 'fresh bread': ['ov-a', 'ov-b'] });
    const { call, cookie, detail } = await setupWith(web, [word('chleb', { imageQuery: '' })]);
    const search = await json<{
      results: Array<{ id: string; provider: string; previewUrl: string }>;
    }>(call('/api/pictures/search?q=fresh%20bread', { cookie }));
    expect(search.results.map((r) => r.id)).toEqual(['ov-a', 'ov-b']);
    expect(search.results[0]?.previewUrl).toContain('/thumb/');

    const lexemeId = (await detail()).words[0]?.lexemeId;
    const chosen = await json<PictureDto>(
      call(`/api/words/${lexemeId}/picture`, {
        method: 'POST',
        cookie,
        body: { provider: 'openverse', id: 'ov-b' },
      }),
    );
    expect(chosen.title).toBe('photo ov-b');
    expect((await detail()).words[0]?.image?.id).toBe(chosen.id);
  });

  it('keeps a shared word’s default when another learner picks their own', async () => {
    const web = fakeWeb({ bread: ['ov-default'], 'my bread': ['ov-mine'] });
    const ctx = createTestApp({ fetchFn: web.fetchFn });
    const alice = await ctx.createUser('alice@test.dev');
    const bob = await ctx.createUser('bob@test.dev');
    const make = (cookie: string) =>
      json<ThemeSummaryDto>(
        ctx.call('/api/themes', {
          method: 'POST',
          cookie,
          body: { name: 'T', words: [word('chleb', { imageQuery: 'bread' })] },
        }),
      );
    const aliceTheme = await make(alice);
    await ctx.deps.pictures.idle();
    const bobTheme = await make(bob);
    const lexemeId = ctx.db.select().from(schema.lexemes).get()?.id;

    await ctx.call(`/api/words/${lexemeId}/picture`, {
      method: 'POST',
      cookie: bob,
      body: { provider: 'openverse', id: 'ov-mine' },
    });
    const seen = async (cookie: string, id: string) =>
      (await json<ThemeDetailDto>(ctx.call(`/api/themes/${id}`, { cookie }))).words[0]?.image
        ?.title;
    expect(await seen(alice, aliceTheme.id)).toBe('photo ov-default');
    expect(await seen(bob, bobTheme.id)).toBe('photo ov-mine');
  });

  it('uploads a private picture and can hide and restore pictures', async () => {
    const web = fakeWeb({});
    const { call, raw, cookie, detail } = await setupWith(web, [word('chleb', { imageQuery: '' })]);
    const lexemeId = (await detail()).words[0]?.lexemeId;
    const upload = (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return raw(`/api/words/${lexemeId}/picture/upload`, { method: 'POST', cookie, body: form });
    };

    const res = await upload(new File([new Uint8Array(png)], 'bread.png', { type: 'image/png' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ provider: 'upload', license: 'Own upload' });
    expect((await upload(new File(['hello'], 'x.png', { type: 'image/png' }))).status).toBe(422);

    await call(`/api/words/${lexemeId}/picture/visibility`, {
      method: 'PUT',
      cookie,
      body: { hidden: true },
    });
    expect((await detail()).words[0]).toMatchObject({ image: null, imageHidden: true });
    await call(`/api/words/${lexemeId}/picture/visibility`, {
      method: 'PUT',
      cookie,
      body: { hidden: false },
    });
    expect((await detail()).words[0]?.image?.provider).toBe('upload');
  });

  it('refuses images hosted on private addresses (SSRF)', async () => {
    const web = fakeWeb({ bread: ['ov-evil'] }, { privateUrl: true });
    const { call, cookie, detail, db } = await setupWith(web, [word('chleb', { imageQuery: '' })]);
    const lexemeId = (await detail()).words[0]?.lexemeId;
    const res = await call(`/api/words/${lexemeId}/picture`, {
      method: 'POST',
      cookie,
      body: { provider: 'openverse', id: 'ov-evil' },
    });
    expect(res.status).toBe(422);
    expect(db.select().from(schema.lexemeImages).all()).toEqual([]);
    expect(web.calls.some((u) => u.includes('127.0.0.1'))).toBe(false);
  });

  it('requires a session for media and rejects odd file names', async () => {
    const web = fakeWeb({ bread: ['ov-1'] });
    const { call, cookie, detail } = await setupWith(web, [word('chleb', { imageQuery: 'bread' })]);
    const url = (await detail()).words[0]?.image?.url ?? '';
    expect((await call(url)).status).toBe(401);
    expect((await call('/api/media/..%2F..%2F.env', { cookie })).status).toBe(404);
  });

  it('shows the picture on review cards', async () => {
    const web = fakeWeb({ bread: ['ov-1'] });
    const { call, cookie } = await setupWith(web, [word('chleb', { imageQuery: 'bread' })]);
    const queue = await json<ReviewQueueDto>(call('/api/review/queue?tzOffset=0', { cookie }));
    expect(queue.cards[0]?.image?.title).toBe('photo ov-1');
  });

  it('retries missing pictures for a theme on request', async () => {
    const web = fakeWeb({}, { limited: true });
    const ctx = await setupWith(web, [word('chleb', { imageQuery: 'bread' })]);
    const res = await json<{ queued: number }>(
      ctx.call(`/api/themes/${ctx.theme.id}/pictures`, { method: 'POST', cookie: ctx.cookie }),
    );
    expect(res.queued).toBe(1);
    await ctx.deps.pictures.idle();
    expect(
      ctx.db.select().from(schema.lexemes).where(eq(schema.lexemes.lemma, 'chleb')).get()?.imageId,
    ).toBeNull();
  });
});

describe('Wikimedia Commons', () => {
  it('is tried first, and Openverse is not asked when Commons has a picture', async () => {
    const web = fakeWeb({ bread: ['ov-1'] }, { commons: { bread: [42] } });
    const { detail } = await setupWith(web, [word('chleb', { imageQuery: 'bread' })]);
    expect((await detail()).words[0]?.image).toMatchObject({
      provider: 'wikimedia',
      title: 'Commons photo 42',
      creator: 'Jan K&owalski',
      creatorUrl: 'https://commons.wikimedia.org/wiki/User:Jan',
      license: 'CC BY-SA 4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Commons_photo_42.jpg',
    });
    expect(web.calls.some((u) => u.includes('openverse'))).toBe(false);
    // The 500 px thumbnail is downloaded, not the full-size original.
    expect(web.calls).toContain(IMG('commons-42'));
    expect(web.calls).not.toContain(IMG('commons-42-full'));
  });

  it('falls back to Openverse when Commons finds nothing', async () => {
    const web = fakeWeb({ bread: ['ov-1'] });
    const { detail } = await setupWith(web, [word('chleb', { imageQuery: 'bread' })]);
    expect((await detail()).words[0]?.image?.provider).toBe('openverse');
    const searched = web.calls.filter((u) => u.includes('commons') || u.includes('/v1/images/?'));
    expect(searched[0]).toContain('commons.wikimedia.org');
  });

  it('merges providers in the picker and lets the learner choose a Commons photo', async () => {
    const web = fakeWeb({ bread: ['ov-1'] }, { commons: { bread: [7, 8] } });
    const { call, cookie, detail } = await setupWith(web, [word('chleb', { imageQuery: '' })]);
    const search = await json<{ results: Array<{ id: string; provider: string }> }>(
      call('/api/pictures/search?q=bread', { cookie }),
    );
    expect(search.results.map((r) => `${r.provider}:${r.id}`)).toEqual([
      'wikimedia:7',
      'wikimedia:8',
      'openverse:ov-1',
    ]);
    const lexemeId = (await detail()).words[0]?.lexemeId;
    const res = await call(`/api/words/${lexemeId}/picture`, {
      method: 'POST',
      cookie,
      body: { provider: 'wikimedia', id: '8' },
    });
    expect(res.status).toBe(200);
    expect((await detail()).words[0]?.image?.title).toBe('Commons photo 8');
  });

  it('still shows Commons results when Openverse times out in the picker', async () => {
    const web = fakeWeb({}, { commons: { bread: [7] }, openverseTimeouts: 1 });
    const { call, cookie } = await setupWith(web, [word('chleb', { imageQuery: '' })]);
    const res = await call('/api/pictures/search?q=bread', { cookie });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { results: unknown[] }).results).toHaveLength(1);
  });
});

describe('rate limits and pacing', () => {
  it('waits out a short Retry-After from Wikimedia and retries once', async () => {
    const web = fakeWeb(
      {},
      { commons: { bread: [5] }, commonsLimited: { times: 1, retryAfter: '0' } },
    );
    const { detail, call, cookie } = await setupWith(web, [word('chleb', { imageQuery: 'bread' })]);
    expect((await detail()).words[0]?.image?.provider).toBe('wikimedia');
    // Not blocked afterwards: the picker can still ask Wikimedia.
    const res = await call('/api/pictures/search?q=bread&provider=wikimedia', { cookie });
    expect(res.status).toBe(200);
  });

  it('skips a provider for as long as a long Retry-After says, with a clear message', async () => {
    const web = fakeWeb(
      { bread: ['ov-1'] },
      { commons: { bread: [5] }, commonsLimited: { times: 1, retryAfter: '120' } },
    );
    const { detail, call, cookie } = await setupWith(web, [word('chleb', { imageQuery: 'bread' })]);
    expect((await detail()).words[0]?.image?.provider).toBe('openverse');
    const res = await call('/api/pictures/search?q=bread&provider=wikimedia', { cookie });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /Wikimedia Commons has reached its limit. Try again in 2 min/,
    );
  });

  it('sends Wikimedia requests one at a time', async () => {
    const web = fakeWeb({}, { commons: { bread: [1], roll: [2], cake: [3] }, commonsDelayMs: 20 });
    const ctx = await setupWith(web, [word('chleb', { imageQuery: '' })]);
    await Promise.all(
      ['bread', 'roll', 'cake'].map((q) =>
        ctx.call(`/api/pictures/search?q=${q}&provider=wikimedia`, { cookie: ctx.cookie }),
      ),
    );
    expect(web.maxCommonsInFlight?.()).toBe(1);
  });

  it('identifies the app, with the configured contact, to providers', async () => {
    const web = fakeWeb({}, { commons: { bread: [1] } });
    const ctx = createTestApp({ fetchFn: web.fetchFn });
    const pictures = createPictureService({
      db: ctx.db,
      store: createPictureStore(mkdtempSync(join(tmpdir(), 'alivocab-media-'))),
      fetchFn: web.fetchFn,
      contact: 'https://vocab.example.org',
      wikimediaGapMs: 0,
    });
    await pictures.search('bread', 'wikimedia');
    expect(web.userAgents?.[0]).toBe(
      'AliVocab/0.1 (self-hosted vocabulary trainer; https://vocab.example.org)',
    );
  });
});

describe('picker per provider', () => {
  it('lists the providers and searches one at a time', async () => {
    const web = fakeWeb({ bread: ['ov-1'] }, { commons: { bread: [7] } });
    const { call, cookie } = await setupWith(web, [word('chleb', { imageQuery: '' })]);
    expect(await json(call('/api/pictures/providers', { cookie }))).toEqual({
      providers: ['wikimedia', 'openverse'],
    });
    const only = await json<{ results: Array<{ provider: string }> }>(
      call('/api/pictures/search?q=bread&provider=openverse', { cookie }),
    );
    expect(only.results.map((r) => r.provider)).toEqual(['openverse']);
    const pexels = await call('/api/pictures/search?q=bread&provider=pexels', { cookie });
    expect(pexels.status).toBe(400);
  });

  it('reports a slow provider as a timeout', async () => {
    const web = fakeWeb({}, { openverseTimeouts: 1 });
    const { call, cookie } = await setupWith(web, [word('chleb', { imageQuery: '' })]);
    const res = await call('/api/pictures/search?q=bread&provider=openverse', { cookie });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe(
      'Openverse took too long to answer',
    );
  });
});

describe('automatic pictures: phrases', () => {
  it('falls back to the translation when the AI phrase finds nothing', async () => {
    const web = fakeWeb({}, { commons: { 'chleb-en': [9] } });
    const { detail } = await setupWith(web, [
      word('chleb', { imageQuery: 'freshly baked crusty loaf on a wooden board' }),
    ]);
    expect((await detail()).words[0]?.image?.title).toBe('Commons photo 9');
    const commonsQueries = web.calls
      .filter((u) => u.includes('commons.wikimedia.org'))
      .map((u) => new URL(u).searchParams.get('gsrsearch'));
    expect(commonsQueries).toEqual([
      'freshly baked crusty loaf on a wooden board filetype:bitmap',
      'chleb-en filetype:bitmap',
    ]);
    // Openverse is not needed once Commons found something.
    expect(web.calls.some((u) => u.includes('openverse'))).toBe(false);
  });
});

describe('automatic pictures: failures', () => {
  it('retries a word once when Openverse timed out', async () => {
    const web = fakeWeb({ bread: ['ov-1'] }, { openverseTimeouts: 1 });
    const { detail } = await setupWith(web, [word('chleb', { imageQuery: 'bread' })]);
    expect((await detail()).words[0]?.image?.provider).toBe('openverse');
    expect(web.calls.filter((u) => u.includes('/v1/images/?'))).toHaveLength(2);
  });

  it('gives up after one retry and leaves the word unsearched', async () => {
    const web = fakeWeb({ bread: ['ov-1'] }, { openverseTimeouts: 5 });
    const { db } = await setupWith(web, [word('chleb', { imageQuery: 'bread' })]);
    expect(web.calls.filter((u) => u.includes('/v1/images/?'))).toHaveLength(2);
    expect(db.select().from(schema.lexemes).get()).toMatchObject({
      imageId: null,
      imageSearchedAt: null,
    });
  });

  it('does not mark a word as searched when the provider times out', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      });
    });
    const web = { calls: [] as string[], fetchFn };
    const { db } = await setupWith(web, [word('chleb', { imageQuery: 'bread' })]);
    expect(db.select().from(schema.lexemes).get()?.imageSearchedAt).toBeNull();
  });
});

describe('picker performance', () => {
  it('reuses a recent search hit instead of looking the photo up again', async () => {
    const web = fakeWeb({ bread: ['ov-1', 'ov-2'] });
    const { call, cookie, detail } = await setupWith(web, [word('chleb', { imageQuery: '' })]);
    await call('/api/pictures/search?q=bread', { cookie });
    const lexemeId = (await detail()).words[0]?.lexemeId;
    const res = await call(`/api/words/${lexemeId}/picture`, {
      method: 'POST',
      cookie,
      body: { provider: 'openverse', id: 'ov-2' },
    });
    expect(res.status).toBe(200);
    expect(web.calls.some((u) => /\/v1\/images\/ov-2\/$/.test(u))).toBe(false);
  });
});
