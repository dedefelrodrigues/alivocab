/**
 * Free photo search providers. Openverse needs no key (anonymous: 20/min, 200/day per server);
 * Pexels is optional (PEXELS_API_KEY, 200/hour). Results are normalized to one shape.
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
  constructor(readonly provider: string) {
    super(`${provider} picture search limit reached; try again later`);
  }
}

const USER_AGENT = 'AliVocab/0.1 (self-hosted vocabulary trainer)';

async function getJson(
  fetchFn: typeof fetch,
  provider: string,
  url: string,
  headers: Record<string, string> = {},
) {
  const res = await fetchFn(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
    // Openverse can take ~10 s for a query it has not seen before (then it is cached).
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 429) throw new ProviderLimitError(provider);
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
  async search(fetchFn: typeof fetch, q: string, size = 12): Promise<ProviderHit[]> {
    const url = `${OPENVERSE}?${new URLSearchParams({ q, page_size: String(size), mature: 'false' })}`;
    const body = (await getJson(fetchFn, 'Openverse', url)) as {
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
  async search(fetchFn: typeof fetch, key: string, q: string, size = 12): Promise<ProviderHit[]> {
    const url = `https://api.pexels.com/v1/search?${new URLSearchParams({ query: q, per_page: String(size) })}`;
    const body = (await getJson(fetchFn, 'Pexels', url, { Authorization: key })) as {
      photos?: PexelsPhoto[];
    } | null;
    return (body?.photos ?? []).map(fromPexels);
  },
  async get(fetchFn: typeof fetch, key: string, id: string): Promise<ProviderHit | null> {
    if (!/^\d{1,20}$/.test(id)) return null;
    const body = (await getJson(fetchFn, 'Pexels', `https://api.pexels.com/v1/photos/${id}`, {
      Authorization: key,
    })) as PexelsPhoto | null;
    return body ? fromPexels(body) : null;
  },
};
