/**
 * Free photo search providers, normalized to one shape. Wikimedia Commons needs no key and
 * answers in about a second. Openverse needs no key either but is slow (often 10–20 s for a new
 * query) and limited (anonymous: 20/min, 200/day per server). Pexels is optional
 * (PEXELS_API_KEY, 200/hour).
 */
import type { PictureSearchResult } from '@alivocab/shared';

export type ProviderHit = PictureSearchResult & {
  /** Full-size image to download when chosen. */
  downloadUrl: string;
  creatorUrl: string | null;
  licenseUrl: string | null;
  sourceUrl: string | null;
};

export class ProviderLimitError extends Error {
  constructor(
    readonly provider: string,
    /** From the Retry-After header, when the provider sent one. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(`${provider} picture search limit reached; try again later`);
  }
}

/** Retry-After as milliseconds (seconds or an HTTP date), or null. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export type SearchOptions = { size?: number; timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 25_000;

async function getJson(
  fetchFn: typeof fetch,
  provider: string,
  url: string,
  {
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: { headers?: Record<string, string>; timeoutMs?: number } = {},
) {
  const res = await fetchFn(url, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 429) {
    throw new ProviderLimitError(provider, parseRetryAfter(res.headers.get('retry-after')));
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${provider} returned HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

// ── Openverse ───────────────────────────────────────────────────────────────

type OpenverseImage = {
  id: string;
  title?: string | null;
  url: string;
  thumbnail?: string | null;
  creator?: string | null;
  creator_url?: string | null;
  license?: string;
  license_version?: string | null;
  license_url?: string | null;
  foreign_landing_url?: string | null;
  width?: number | null;
  height?: number | null;
};

const OPENVERSE = 'https://api.openverse.org/v1/images/';

function licenseLabel(license?: string, version?: string | null): string | null {
  if (!license) return null;
  if (license === 'cc0') return 'CC0';
  if (license === 'pdm') return 'Public domain';
  return `CC ${license.toUpperCase()}${version ? ` ${version}` : ''}`;
}

function fromOpenverse(r: OpenverseImage): ProviderHit {
  return {
    provider: 'openverse',
    id: r.id,
    previewUrl: r.thumbnail || r.url,
    downloadUrl: r.url,
    width: r.width ?? 0,
    height: r.height ?? 0,
    title: r.title || null,
    creator: r.creator || null,
    creatorUrl: r.creator_url || null,
    license: licenseLabel(r.license, r.license_version),
    licenseUrl: r.license_url || null,
    sourceUrl: r.foreign_landing_url || null,
  };
}

export const openverse = {
  name: 'openverse' as const,
  async search(
    fetchFn: typeof fetch,
    q: string,
    { size = 12, timeoutMs }: SearchOptions = {},
  ): Promise<ProviderHit[]> {
    const url = `${OPENVERSE}?${new URLSearchParams({ q, page_size: String(size), mature: 'false' })}`;
    const body = (await getJson(fetchFn, 'Openverse', url, { timeoutMs })) as {
      results?: OpenverseImage[];
    } | null;
    return (body?.results ?? []).filter((r) => r.url).map(fromOpenverse);
  },
  async get(fetchFn: typeof fetch, id: string): Promise<ProviderHit | null> {
    if (!/^[\w-]{1,64}$/.test(id)) return null;
    const body = (await getJson(
      fetchFn,
      'Openverse',
      `${OPENVERSE}${id}/`,
    )) as OpenverseImage | null;
    return body?.url ? fromOpenverse(body) : null;
  },
};

// ── Wikimedia Commons ───────────────────────────────────────────────────────

const COMMONS = 'https://commons.wikimedia.org/w/api.php';
/** Wikimedia serves a fixed set of thumbnail widths; 500 is the one just above our 480 px. */
const COMMONS_THUMB_WIDTH = 500;
const COMMONS_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type CommonsPage = {
  pageid: number;
  title: string;
  index?: number;
  imageinfo?: Array<{
    url: string;
    thumburl?: string;
    thumbwidth?: number;
    thumbheight?: number;
    width: number;
    height: number;
    mime: string;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string } | undefined>;
  }>;
};

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Commons metadata is HTML; credits are shown as plain text. */
function htmlToText(html: string | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code =
          e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/** The first link in the Artist field (often a user page), made absolute. */
function firstHref(html: string | undefined): string | null {
  const href = html && /href="([^"]+)"/.exec(html)?.[1];
  if (!href) return null;
  const abs = href.startsWith('//') ? `https:${href}` : href;
  return /^https:\/\//.test(abs) ? abs.replace(/&amp;/g, '&') : null;
}

function fromCommons(page: CommonsPage): ProviderHit | null {
  const info = page.imageinfo?.[0];
  if (!info || !COMMONS_MIMES.has(info.mime)) return null;
  const meta = info.extmetadata ?? {};
  const fileName = page.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '');
  const image = info.thumburl ?? info.url;
  return {
    provider: 'wikimedia',
    id: String(page.pageid),
    previewUrl: image,
    downloadUrl: image,
    width: info.width,
    height: info.height,
    title: htmlToText(meta.ObjectName?.value) ?? fileName,
    creator: htmlToText(meta.Artist?.value)?.slice(0, 200) ?? null,
    creatorUrl: firstHref(meta.Artist?.value),
    license: htmlToText(meta.LicenseShortName?.value),
    licenseUrl: meta.LicenseUrl?.value || null,
    sourceUrl: info.descriptionurl ?? null,
  };
}

function commonsParams(extra: Record<string, string>) {
  return new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: String(COMMONS_THUMB_WIDTH),
    iiextmetadatafilter: 'ObjectName|Artist|LicenseShortName|LicenseUrl',
    ...extra,
  });
}

export const wikimedia = {
  name: 'wikimedia' as const,
  async search(
    fetchFn: typeof fetch,
    q: string,
    { size = 12, timeoutMs }: SearchOptions = {},
  ): Promise<ProviderHit[]> {
    const params = commonsParams({
      generator: 'search',
      gsrnamespace: '6',
      // Photos only (no SVG diagrams, PDFs or audio).
      gsrsearch: `${q} filetype:bitmap`,
      gsrlimit: String(size),
    });
    const body = (await getJson(fetchFn, 'Wikimedia Commons', `${COMMONS}?${params}`, {
      timeoutMs,
    })) as { query?: { pages?: CommonsPage[] } } | null;
    return (body?.query?.pages ?? [])
      .toSorted((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(fromCommons)
      .filter((h): h is ProviderHit => h !== null);
  },
  async get(fetchFn: typeof fetch, id: string): Promise<ProviderHit | null> {
    if (!/^\d{1,20}$/.test(id)) return null;
    const body = (await getJson(
      fetchFn,
      'Wikimedia Commons',
      `${COMMONS}?${commonsParams({ pageids: id })}`,
    )) as { query?: { pages?: CommonsPage[] } } | null;
    const page = body?.query?.pages?.[0];
    return page ? fromCommons(page) : null;
  },
};

// ── Pexels ──────────────────────────────────────────────────────────────────

type PexelsPhoto = {
  id: number;
  width: number;
  height: number;
  url: string;
  alt?: string | null;
  photographer?: string | null;
  photographer_url?: string | null;
  src: { large: string; medium: string; small: string };
};

function fromPexels(p: PexelsPhoto): ProviderHit {
  return {
    provider: 'pexels',
    id: String(p.id),
    previewUrl: p.src.medium || p.src.small,
    downloadUrl: p.src.large,
    width: p.width,
    height: p.height,
    title: p.alt || null,
    creator: p.photographer || null,
    creatorUrl: p.photographer_url || null,
    license: 'Pexels License',
    licenseUrl: 'https://www.pexels.com/license/',
    sourceUrl: p.url,
  };
}

export const pexels = {
  name: 'pexels' as const,
  async search(
    fetchFn: typeof fetch,
    key: string,
    q: string,
    { size = 12, timeoutMs }: SearchOptions = {},
  ): Promise<ProviderHit[]> {
    const url = `https://api.pexels.com/v1/search?${new URLSearchParams({ query: q, per_page: String(size) })}`;
    const body = (await getJson(fetchFn, 'Pexels', url, {
      headers: { Authorization: key },
      timeoutMs,
    })) as {
      photos?: PexelsPhoto[];
    } | null;
    return (body?.photos ?? []).map(fromPexels);
  },
  async get(fetchFn: typeof fetch, key: string, id: string): Promise<ProviderHit | null> {
    if (!/^\d{1,20}$/.test(id)) return null;
    const body = (await getJson(fetchFn, 'Pexels', `https://api.pexels.com/v1/photos/${id}`, {
      headers: { Authorization: key },
    })) as PexelsPhoto | null;
    return body ? fromPexels(body) : null;
  },
};
