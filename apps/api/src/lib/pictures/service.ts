/**
 * Pictures for words: search across free providers, choosing or uploading a picture, and a
 * background queue that picks one automatically for newly saved words.
 */
import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import type { PictureDto, PictureSearchResult, SearchProvider } from '@alivocab/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { unwrapImageLink } from './links.ts';
import { openverse, type ProviderHit, ProviderLimitError, pexels, wikimedia } from './providers.ts';
import { downloadImage, ImageDownloadError, type PictureStore } from './store.ts';

const { lexemes, lexemeImages, lexemeTranslations, userLexemes } = schema;
type ImageRow = typeof lexemeImages.$inferSelect;

export function toPictureDto(row: ImageRow): PictureDto {
  return {
    id: row.id,
    provider: row.provider,
    url: `/api/media/${row.fileKey}.webp`,
    thumbUrl: `/api/media/${row.fileKey}-thumb.webp`,
    width: row.width,
    height: row.height,
    title: row.title,
    creator: row.creator,
    creatorUrl: row.creatorUrl,
    license: row.license,
    licenseUrl: row.licenseUrl,
    sourceUrl: row.sourceUrl,
  };
}

/** Parts of speech that are usually worth picturing when no explicit query is known. */
const PICTURABLE_BY_DEFAULT = new Set(['noun']);

/**
 * How long a picker search waits. The picker asks each provider separately and shows results as
 * they arrive, so a slow provider only delays its own results. A combined search (all providers
 * in one request) waits less, so the fast ones aren't held up for long.
 */
const PICKER_TIMEOUT_MS = 20_000;
const COMBINED_TIMEOUT_MS = 10_000;

export type PictureServiceOptions = {
  db: Db;
  store: PictureStore;
  fetchFn?: typeof fetch;
  pexelsKey?: string;
  /**
   * Contact for the User-Agent (a URL or email). Wikimedia asks API clients to identify
   * themselves this way and is stricter with anonymous ones.
   */
  contact?: string;
  /** Minimum spacing between Openverse calls (anonymous burst limit is 20/min). */
  openverseIntervalMs?: number;
  /** Gap between Wikimedia calls, which are sent one at a time (it refuses parallel bursts). */
  wikimediaGapMs?: number;
  /** Longest Retry-After we wait out before retrying once; longer ones skip the provider. */
  maxRetryWaitMs?: number;
  log?: (msg: string) => void;
};

/** How long a provider is skipped after a limit error that gave no Retry-After. */
const DEFAULT_BLOCK_MS = 5 * 60_000;
const MAX_BLOCK_MS = 60 * 60_000;

const PROVIDER_NAMES: Record<SearchProvider, string> = {
  wikimedia: 'Wikimedia Commons',
  openverse: 'Openverse',
  pexels: 'Pexels',
};

/**
 * Pictures the learner brought themselves (a file, or a link from any site). Their license is
 * unknown, so they are only ever shown to that learner, never used as the shared default.
 */
const PRIVATE_PROVIDERS = new Set<ImageRow['provider']>(['upload', 'link']);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createPictureService(opts: PictureServiceOptions) {
  const { db, store } = opts;
  const baseFetch = opts.fetchFn ?? fetch;
  const userAgent = `AliVocab/0.1 (self-hosted vocabulary trainer${opts.contact ? `; ${opts.contact}` : ''})`;
  /** Every provider and image request identifies the app. */
  const fetchFn: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('User-Agent', userAgent);
    return baseFetch(input, { ...init, headers });
  };
  const interval = opts.openverseIntervalMs ?? 3_100;
  const wikimediaGap = opts.wikimediaGapMs ?? 150;
  const maxRetryWait = opts.maxRetryWaitMs ?? 10_000;
  const log = opts.log ?? (() => {});

  // ── Provider access with politeness and back-off ─────────────────────────
  let nextOpenverseAt = 0;
  const blockedUntil = new Map<string, number>();

  const usable = (name: string) => (blockedUntil.get(name) ?? 0) <= Date.now();

  /** Wikimedia calls run one after another; this is the tail of that line. */
  let wikimediaLane: Promise<unknown> = Promise.resolve();

  function paced<T>(name: SearchProvider, fn: () => Promise<T>): Promise<T> {
    if (name === 'wikimedia') {
      const run = wikimediaLane.then(fn);
      wikimediaLane = run.then(
        () => sleep(wikimediaGap),
        () => sleep(wikimediaGap),
      );
      return run;
    }
    if (name === 'openverse') {
      const wait = nextOpenverseAt - Date.now();
      nextOpenverseAt = Math.max(Date.now(), nextOpenverseAt) + interval;
      if (wait > 0) return sleep(wait).then(fn);
    }
    return fn();
  }

  /**
   * Calls a provider politely. A short Retry-After (Wikimedia sends a few seconds for bursts) is
   * waited out and retried once; otherwise the provider is skipped for a while.
   */
  async function callProvider<T>(name: SearchProvider, fn: () => Promise<T>): Promise<T> {
    try {
      return await paced(name, fn);
    } catch (err) {
      if (!(err instanceof ProviderLimitError)) throw err;
      if (err.retryAfterMs !== null && err.retryAfterMs <= maxRetryWait) {
        await sleep(err.retryAfterMs);
        try {
          return await paced(name, fn);
        } catch (again) {
          if (again instanceof ProviderLimitError) block(name, again.retryAfterMs);
          throw again;
        }
      }
      block(name, err.retryAfterMs);
      throw err;
    }
  }

  function block(name: SearchProvider, retryAfterMs: number | null) {
    const ms = Math.min(MAX_BLOCK_MS, Math.max(retryAfterMs ?? DEFAULT_BLOCK_MS, 1_000));
    blockedUntil.set(name, Date.now() + ms);
    log(`${name} is rate-limited; skipping it for ${Math.round(ms / 1000)} s`);
  }

  /** Configured providers, best first: Pexels (with a key), Wikimedia (fast), Openverse (slow). */
  const configured: SearchProvider[] = [
    ...(opts.pexelsKey ? (['pexels'] as const) : []),
    'wikimedia',
    'openverse',
  ];
  const providerOrder = () => configured.filter(usable);

  /**
   * Recent search hits, so choosing one doesn't need another (slow, rate-limited) provider
   * lookup. Bounded and short-lived.
   */
  const recentHits = new Map<string, { hit: ProviderHit; at: number }>();
  const HIT_TTL_MS = 60 * 60_000;
  const remember = (hits: ProviderHit[]) => {
    const now = Date.now();
    for (const hit of hits) recentHits.set(`${hit.provider}:${hit.id}`, { hit, at: now });
    for (const [key, v] of recentHits) {
      if (recentHits.size <= 2000 && now - v.at < HIT_TTL_MS) break;
      recentHits.delete(key);
    }
  };
  const recalled = (provider: string, id: string) => {
    const entry = recentHits.get(`${provider}:${id}`);
    return entry && Date.now() - entry.at < HIT_TTL_MS ? entry.hit : null;
  };

  /** Always asks for 12, so the picker and auto-pick share Openverse's cache for a query. */
  async function searchProvider(
    name: SearchProvider,
    q: string,
    timeoutMs?: number,
  ): Promise<ProviderHit[]> {
    const options = { size: 12, timeoutMs };
    const hits = await callProvider(name, () => {
      if (name === 'pexels') return pexels.search(fetchFn, opts.pexelsKey ?? '', q, options);
      if (name === 'wikimedia') return wikimedia.search(fetchFn, q, options);
      return openverse.search(fetchFn, q, options);
    });
    remember(hits);
    return hits;
  }

  const toResult = ({
    downloadUrl: _d,
    creatorUrl: _c,
    licenseUrl: _l,
    sourceUrl: _s,
    ...hit
  }: ProviderHit): PictureSearchResult => hit;

  function limitedMessage(name?: SearchProvider) {
    const until = Math.max(...(name ? [name] : configured).map((n) => blockedUntil.get(n) ?? 0));
    const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
    return `${name ? `${PROVIDER_NAMES[name]} has` : 'Picture search has'} reached its limit. Try again in ${minutes} min.`;
  }

  /**
   * Picker search. With `only`, asks that one provider (the picker does this per provider to show
   * results as they arrive); otherwise all available providers in parallel.
   */
  async function search(q: string, only?: SearchProvider): Promise<PictureSearchResult[]> {
    if (only) {
      if (!configured.includes(only)) {
        throw new HTTPException(400, { message: `${PROVIDER_NAMES[only]} is not configured` });
      }
      if (!usable(only)) throw new HTTPException(503, { message: limitedMessage(only) });
      try {
        return (await searchProvider(only, q, PICKER_TIMEOUT_MS)).map(toResult);
      } catch (err) {
        log(`picture search via ${only} failed: ${(err as Error).message}`);
        if (err instanceof ProviderLimitError) {
          throw new HTTPException(503, { message: limitedMessage(only) });
        }
        const timedOut = (err as Error).name === 'TimeoutError';
        throw new HTTPException(502, {
          message: timedOut
            ? `${PROVIDER_NAMES[only]} took too long to answer`
            : (err as Error).message,
        });
      }
    }
    const order = providerOrder();
    if (!order.length) throw new HTTPException(503, { message: limitedMessage() });
    const settled = await Promise.allSettled(
      order.map((name) => searchProvider(name, q, COMBINED_TIMEOUT_MS)),
    );
    const results: PictureSearchResult[] = [];
    let lastError: unknown = null;
    settled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        results.push(...outcome.value.map(toResult));
      } else {
        lastError = outcome.reason;
        log(`picture search via ${order[i]} failed: ${(outcome.reason as Error).message}`);
      }
    });
    if (!results.length && lastError) {
      throw new HTTPException(502, { message: (lastError as Error).message });
    }
    return results;
  }

  // ── Storing ──────────────────────────────────────────────────────────────

  async function storeHit(
    lexemeId: string,
    hit: ProviderHit,
    createdBy: string | null,
  ): Promise<ImageRow> {
    const existing = db
      .select()
      .from(lexemeImages)
      .where(
        and(
          eq(lexemeImages.lexemeId, lexemeId),
          eq(lexemeImages.provider, hit.provider),
          eq(lexemeImages.providerId, hit.id),
        ),
      )
      .get();
    if (existing) return existing;
    const saved = await store.save(await downloadImage(hit.downloadUrl, fetchFn));
    return db
      .insert(lexemeImages)
      .values({
        lexemeId,
        provider: hit.provider,
        providerId: hit.id,
        fileKey: saved.fileKey,
        width: saved.width,
        height: saved.height,
        title: hit.title?.slice(0, 200) ?? null,
        creator: hit.creator?.slice(0, 200) ?? null,
        creatorUrl: hit.creatorUrl,
        license: hit.license,
        licenseUrl: hit.licenseUrl,
        sourceUrl: hit.sourceUrl,
        createdBy,
      })
      .returning()
      .get();
  }

  function ownLexeme(userId: string, lexemeId: string) {
    const own = db
      .select({ lexemeId: userLexemes.lexemeId })
      .from(userLexemes)
      .where(and(eq(userLexemes.userId, userId), eq(userLexemes.lexemeId, lexemeId)))
      .get();
    if (!own) throw new HTTPException(404, { message: 'Word not found in your dictionary' });
  }

  /**
   * Applies a picture for a user: it becomes their personal choice, and also the shared
   * default when the word has none yet or the user may edit shared data.
   */
  function applyChoice(userId: string, lexemeId: string, image: ImageRow, canSetDefault: boolean) {
    db.transaction((tx) => {
      tx.update(userLexemes)
        .set({ imageId: image.id, imageHidden: false })
        .where(and(eq(userLexemes.userId, userId), eq(userLexemes.lexemeId, lexemeId)))
        .run();
      const lexeme = tx
        .select({ imageId: lexemes.imageId })
        .from(lexemes)
        .where(eq(lexemes.id, lexemeId))
        .get();
      if (!PRIVATE_PROVIDERS.has(image.provider) && (canSetDefault || !lexeme?.imageId)) {
        tx.update(lexemes).set({ imageId: image.id }).where(eq(lexemes.id, lexemeId)).run();
      }
    });
  }

  async function choose(
    userId: string,
    lexemeId: string,
    choice: { provider: SearchProvider; id: string },
    canSetDefault: boolean,
  ): Promise<PictureDto> {
    ownLexeme(userId, lexemeId);
    if (choice.provider === 'pexels' && !opts.pexelsKey) {
      throw new HTTPException(400, { message: 'Pexels is not configured' });
    }
    let hit: ProviderHit | null = recalled(choice.provider, choice.id);
    try {
      hit ??= await callProvider(choice.provider, () => {
        if (choice.provider === 'pexels')
          return pexels.get(fetchFn, opts.pexelsKey ?? '', choice.id);
        if (choice.provider === 'wikimedia') return wikimedia.get(fetchFn, choice.id);
        return openverse.get(fetchFn, choice.id);
      });
    } catch (err) {
      throw new HTTPException(502, { message: (err as Error).message });
    }
    if (!hit) throw new HTTPException(404, { message: 'Picture not found at the provider' });
    let image: ImageRow;
    try {
      image = await storeHit(lexemeId, hit, userId);
    } catch (err) {
      throw new HTTPException(422, {
        message: `Could not use this picture: ${(err as Error).message}`,
      });
    }
    applyChoice(userId, lexemeId, image, canSetDefault);
    return toPictureDto(image);
  }

  /** Stores a picture the learner brought, as their personal choice only. */
  async function savePrivate(
    userId: string,
    lexemeId: string,
    data: Buffer,
    meta: { provider: 'upload' | 'link'; sourceUrl?: string; title?: string },
  ): Promise<PictureDto> {
    let saved: Awaited<ReturnType<PictureStore['save']>>;
    try {
      saved = await store.save(data);
    } catch {
      throw new HTTPException(422, {
        message:
          meta.provider === 'upload'
            ? 'That file is not an image we can read'
            : 'That link is not a picture we can read',
      });
    }
    const image = db
      .insert(lexemeImages)
      .values({
        lexemeId,
        provider: meta.provider,
        providerId: saved.fileKey,
        fileKey: saved.fileKey,
        width: saved.width,
        height: saved.height,
        title: meta.title ?? null,
        license: meta.provider === 'upload' ? 'Own upload' : null,
        sourceUrl: meta.sourceUrl ?? null,
        createdBy: userId,
      })
      .returning()
      .get();
    applyChoice(userId, lexemeId, image, false);
    return toPictureDto(image);
  }

  async function upload(userId: string, lexemeId: string, data: Buffer): Promise<PictureDto> {
    ownLexeme(userId, lexemeId);
    return savePrivate(userId, lexemeId, data, { provider: 'upload' });
  }

  /**
   * A picture from any web address the learner pasted: an image link, a search-engine result
   * link (unwrapped) or a page (its main image is used).
   */
  async function fromLink(userId: string, lexemeId: string, link: string): Promise<PictureDto> {
    ownLexeme(userId, lexemeId);
    const url = unwrapImageLink(link);
    let data: Buffer;
    try {
      data = await downloadImage(url, fetchFn, { pageImage: true });
    } catch (err) {
      const message =
        err instanceof ImageDownloadError ? err.message : 'Could not download that picture';
      log(`picture link ${new URL(url).hostname} failed: ${(err as Error).message}`);
      throw new HTTPException(422, {
        message: `${message}. Try copying the image itself and pasting it here instead.`,
      });
    }
    return savePrivate(userId, lexemeId, data, {
      provider: 'link',
      sourceUrl: url,
      title: new URL(url).hostname.replace(/^www\./, ''),
    });
  }

  function setHidden(userId: string, lexemeId: string, hidden: boolean) {
    ownLexeme(userId, lexemeId);
    db.update(userLexemes)
      .set({ imageHidden: hidden })
      .where(and(eq(userLexemes.userId, userId), eq(userLexemes.lexemeId, lexemeId)))
      .run();
  }

  // ── Automatic picking ────────────────────────────────────────────────────

  const queue: string[] = [];
  const queued = new Set<string>();
  /** Words already retried once in this run, after a provider failed. */
  const retried = new Set<string>();
  let running: Promise<void> | null = null;

  /**
   * Search phrases for a word, best first: the AI's phrase, then (for nouns) the English or first
   * translation. An empty AI phrase means the word can't be pictured.
   */
  function queriesFor(lexeme: typeof lexemes.$inferSelect): string[] {
    if (lexeme.imageQuery === '') return [];
    const queries = lexeme.imageQuery ? [lexeme.imageQuery] : [];
    if (PICTURABLE_BY_DEFAULT.has(lexeme.pos)) {
      const translations = db
        .select({ lang: lexemeTranslations.lang, text: lexemeTranslations.text })
        .from(lexemeTranslations)
        .where(eq(lexemeTranslations.lexemeId, lexeme.id))
        .orderBy(asc(lexemeTranslations.sort))
        .all();
      const translation = (translations.find((t) => t.lang === 'en') ?? translations[0])?.text;
      if (translation) queries.push(translation);
    }
    return [...new Set(queries.map((q) => q.trim().toLowerCase()).filter(Boolean))];
  }

  const usableHit = (h: ProviderHit) =>
    !h.width ||
    (h.width >= 200 && h.height >= 200 && h.width / h.height < 2.5 && h.height / h.width < 2.5);

  /** Returns `'retry'` when a provider failed or was skipped, so the word was not fully searched. */
  async function autoPickOne(lexemeId: string): Promise<'retry' | undefined> {
    const lexeme = db.select().from(lexemes).where(eq(lexemes.id, lexemeId)).get();
    if (!lexeme || lexeme.imageId) return;
    const queries = queriesFor(lexeme);
    const markSearched = () =>
      db.update(lexemes).set({ imageSearchedAt: new Date() }).where(eq(lexemes.id, lexemeId)).run();
    if (!queries.length) return void markSearched();

    // The word only counts as "searched" when every provider answered; timeouts, limits and
    // outages leave it unsearched so it can be retried. Each provider tries every phrase before
    // the next (slower) provider is asked.
    const order = providerOrder();
    let incomplete = order.length < configured.length;
    for (const name of order) {
      for (const query of queries) {
        let hits: ProviderHit[];
        try {
          hits = await searchProvider(name, query);
        } catch (err) {
          incomplete = true;
          log(`auto picture for ${lexeme.lemma} via ${name} failed: ${(err as Error).message}`);
          break;
        }
        const hit = hits.find(usableHit);
        if (!hit) continue;
        try {
          const image = await storeHit(lexemeId, hit, null);
          db.update(lexemes)
            .set({ imageId: image.id, imageSearchedAt: new Date() })
            .where(and(eq(lexemes.id, lexemeId), isNull(lexemes.imageId)))
            .run();
          return;
        } catch (err) {
          log(`storing picture for ${lexeme.lemma} failed: ${(err as Error).message}`);
        }
      }
    }
    if (incomplete) return 'retry';
    markSearched();
  }

  async function drain() {
    while (queue.length) {
      const id = queue.shift() as string;
      let again = false;
      try {
        // One retry at the end of the queue: Openverse often answers a query it timed out on
        // once it has had time to cache it.
        again = (await autoPickOne(id)) === 'retry' && !retried.has(id);
      } catch (err) {
        log(`auto picture failed: ${(err as Error).message}`);
      }
      if (again) {
        retried.add(id);
        queue.push(id);
      } else {
        retried.delete(id);
        queued.delete(id);
      }
    }
    running = null;
  }

  /** Queues words without a picture that haven't been searched yet (or all missing, if forced). */
  function enqueue(lexemeIds: string[], { force = false } = {}): number {
    if (!lexemeIds.length) return 0;
    const rows = db
      .select({ id: lexemes.id, searched: lexemes.imageSearchedAt })
      .from(lexemes)
      .where(and(inArray(lexemes.id, lexemeIds), isNull(lexemes.imageId)))
      .all();
    let added = 0;
    for (const r of rows) {
      if ((r.searched && !force) || queued.has(r.id)) continue;
      queued.add(r.id);
      queue.push(r.id);
      added++;
    }
    if (added && !running) running = drain();
    return added;
  }

  return {
    search,
    /** Providers the picker can ask, best first. */
    providers: () => [...configured],
    choose,
    upload,
    fromLink,
    setHidden,
    enqueue,
    isPending: (lexemeId: string) => queued.has(lexemeId),
    /** Resolves when the auto-pick queue is empty (tests). */
    idle: () => running ?? Promise.resolve(),
    read: store.read,
    hasPexels: !!opts.pexelsKey,
  };
}

export type PictureService = ReturnType<typeof createPictureService>;
