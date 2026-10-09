/**
 * Helpers for pictures the learner brings from elsewhere (Google Images, Bing, any web page):
 * links copied from search results often wrap the real image address, and a page link needs
 * its main image found.
 */

/** Query parameters that carry the real image (or page) address in search-engine links. */
const WRAPPED_PARAMS: Array<{ host: RegExp; path?: RegExp; params: string[] }> = [
  // Google Images: /imgres?imgurl=…&imgrefurl=…, and /url?q=… / /url?url=…
  { host: /(^|\.)google\.[a-z.]+$/, path: /^\/imgres/, params: ['imgurl', 'imgrefurl'] },
  { host: /(^|\.)google\.[a-z.]+$/, path: /^\/url/, params: ['url', 'q'] },
  // Bing Images: /images/search?…&mediaurl=…
  { host: /(^|\.)bing\.com$/, path: /^\/images\//, params: ['mediaurl'] },
  // DuckDuckGo image proxy: external-content.duckduckgo.com/iu/?u=…
  { host: /(^|\.)duckduckgo\.com$/, path: /^\/iu/, params: ['u'] },
];

/** Returns the address a search-engine link points to, or the link itself. */
export function unwrapImageLink(link: string): string {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return link.trim();
  }
  for (const rule of WRAPPED_PARAMS) {
    if (!rule.host.test(url.hostname) || (rule.path && !rule.path.test(url.pathname))) continue;
    for (const param of rule.params) {
      const inner = url.searchParams.get(param);
      if (inner && /^https?:\/\//i.test(inner)) return inner;
    }
  }
  return url.toString();
}

const ATTRS = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(ATTRS)) {
    const name = m[1]?.toLowerCase();
    if (name) out[name] = (m[3] ?? m[4] ?? m[5] ?? '').replace(/&amp;/g, '&');
  }
  return out;
}

/**
 * The main image of a web page: `og:image`, then `twitter:image`, then `<link rel="image_src">`.
 * Returns an absolute http(s) URL, or null.
 */
export function findPageImage(html: string, pageUrl: string): string | null {
  const candidates: Record<string, string> = {};
  for (const [tag] of html.matchAll(/<(meta|link)\b[^>]*>/gi)) {
    const a = attributes(tag);
    const key = (a.property ?? a.name ?? a.rel ?? '').toLowerCase();
    const value = a.content ?? a.href;
    if (!value || candidates[key]) continue;
    if (
      ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'image_src'].includes(
        key,
      )
    ) {
      candidates[key] = value;
    }
  }
  const found =
    candidates['og:image:secure_url'] ??
    candidates['og:image'] ??
    candidates['og:image:url'] ??
    candidates['twitter:image'] ??
    candidates.image_src;
  if (!found) return null;
  try {
    const url = new URL(found, pageUrl);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
