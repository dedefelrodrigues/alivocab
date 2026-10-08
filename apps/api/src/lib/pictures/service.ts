/**
 * Pictures for words: search across free providers, choosing or uploading a picture, and a
 * background queue that picks one automatically for newly saved words.
 */
import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import type { PictureDto, PictureSearchResult, SearchProvider } from '@alivocab/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { openverse, type ProviderHit, ProviderLimitError, pexels, wikimedia } from './providers.ts';
import { downloadImage, type PictureStore } from './store.ts';

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
 * How long the picker waits for each provider. Openverse is often slower than this for a new
 * query; the picker then shows what the faster providers found. Auto-pick runs in the
 * background and waits longer.
 */
const PICKER_TIMEOUT_MS = 10_000;

export type PictureServiceOptions = {
  db: Db;
  store: PictureStore;
  fetchFn?: typeof fetch;
  pexelsKey?: string;
  /** Minimum spacing between Openverse calls (anonymous burst limit is 20/min). */
  openverseIntervalMs?: number;
  log?: (msg: string) => void;
};

export function createPictureService(opts: PictureServiceOptions) {
  const { db, store } = opts;
  const fetchFn = opts.fetchFn ?? fetch;
  const interval = opts.openverseIntervalMs ?? 3_100;
  const log = opts.log ?? (() => {});

  // ── Provider access with politeness and back-off ─────────────────────────
  let nextOpenverseAt = 0;
  const blockedUntil = new Map<string, number>();

  const usable = (name: string) => (blockedUntil.get(name) ?? 0) <= Date.now();

  async function callProvider<T>(name: SearchProvider, fn: () => Promise<T>): Promise<T> {
    if (name === 'openverse') {
      const wait = nextOpenverseAt - Date.now();
      nextOpenverseAt = Math.max(Date.now(), nextOpenverseAt) + interval;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ProviderLimitError) blockedUntil.set(name, Date.now() + 60 * 60_000);
      throw err;
    }
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

  /** Picker search: all available providers in parallel, results in provider order. */
  async function search(q: string): Promise<PictureSearchResult[]> {
    const order = providerOrder();
    if (!order.length) {
      throw new HTTPException(503, {
        message: 'Picture search limit reached. Try again in an hour.',
      });
    }
    const settled = await Promise.allSettled(
      order.map((name) => searchProvider(name, q, PICKER_TIMEOUT_MS)),
    );
    const results: PictureSearchResult[] = [];
    let lastError: unknown = null;
    settled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        results.push(
          ...outcome.value.map(
            ({ downloadUrl: _d, creatorUrl: _c, licenseUrl: _l, sourceUrl: _s, ...hit }) => hit,
          ),
        );
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
      if (image.provider !== 'upload' && (canSetDefault || !lexeme?.imageId)) {
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

  async function upload(userId: string, lexemeId: string, data: Buffer): Promise<PictureDto> {
    ownLexeme(userId, lexemeId);
    let saved: Awaited<ReturnType<PictureStore['save']>>;
    try {
      saved = await store.save(data);
    } catch {
      throw new HTTPException(422, { message: 'That file is not an image we can read' });
    }
    const image = db
      .insert(lexemeImages)
      .values({
        lexemeId,
        provider: 'upload',
        providerId: saved.fileKey,
        fileKey: saved.fileKey,
        width: saved.width,
        height: saved.height,
        license: 'Own upload',
        createdBy: userId,
      })
      .returning()
      .get();
    applyChoice(userId, lexemeId, image, false);
    return toPictureDto(image);
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

  /** Search phrase for a word: the AI's phrase, else an English (or any) translation for nouns. */
  function queryFor(lexeme: typeof lexemes.$inferSelect): string | null {
    if (lexeme.imageQuery !== null) return lexeme.imageQuery || null;
    if (!PICTURABLE_BY_DEFAULT.has(lexeme.pos)) return null;
    const translations = db
      .select({ lang: lexemeTranslations.lang, text: lexemeTranslations.text })
      .from(lexemeTranslations)
      .where(eq(lexemeTranslations.lexemeId, lexeme.id))
      .orderBy(asc(lexemeTranslations.sort))
      .all();
    return (translations.find((t) => t.lang === 'en') ?? translations[0])?.text ?? null;
  }

  /** Returns `'retry'` when a provider failed or was skipped, so the word was not fully searched. */
  async function autoPickOne(lexemeId: string): Promise<'retry' | undefined> {
    const lexeme = db.select().from(lexemes).where(eq(lexemes.id, lexemeId)).get();
    if (!lexeme || lexeme.imageId) return;
    const query = queryFor(lexeme);
    const markSearched = () =>
      db.update(lexemes).set({ imageSearchedAt: new Date() }).where(eq(lexemes.id, lexemeId)).run();
    if (!query) return void markSearched();

    // The word only counts as "searched" when every provider answered; timeouts, limits and
    // outages leave it unsearched so it can be retried.
    const order = providerOrder();
    let incomplete = order.length < configured.length;
    for (const name of order) {
      let hits: ProviderHit[];
      try {
        hits = await searchProvider(name, query);
      } catch (err) {
        incomplete = true;
        log(`auto picture for ${lexeme.lemma} via ${name} failed: ${(err as Error).message}`);
        continue;
      }
      const hit = hits.find(
        (h) =>
          !h.width ||
          (h.width >= 200 &&
            h.height >= 200 &&
            h.width / h.height < 2.5 &&
            h.height / h.width < 2.5),
      );
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
    choose,
    upload,
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
