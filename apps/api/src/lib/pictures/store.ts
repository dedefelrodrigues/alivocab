import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { assertPublicUrl } from '../net.ts';
import { findPageImage } from './links.ts';

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAIN_SIZE = 480;
const THUMB_SIZE = 96;

/** `<32 hex>.webp` or `<32 hex>-thumb.webp`. */
export const MEDIA_NAME_RE = /^([a-f0-9]{32})(-thumb)?\.webp$/;

export type StoredImage = { fileKey: string; width: number; height: number };

/** Download problems the learner can act on (shown as is). */
export class ImageDownloadError extends Error {
  constructor(
    readonly reason: 'not_image' | 'refused' | 'too_large' | 'unreachable',
    message: string,
  ) {
    super(message);
  }
}

const MAX_PAGE_BYTES = 1024 * 1024;

/**
 * Downloads an image. Every hop must resolve to a public address (SSRF), redirects are followed
 * manually (max 3) and the body is capped. With `pageImage`, a link to a web page is followed to
 * the page's main image (og:image), sending the page as Referer (some sites require it).
 */
export async function downloadImage(
  url: string,
  fetchFn: typeof fetch = fetch,
  { pageImage = false }: { pageImage?: boolean } = {},
): Promise<Buffer> {
  let current = url;
  let referer: string | undefined;
  let followPage = pageImage;
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:\/\//.test(current)) throw new Error('Unsupported image URL');
    await assertPublicUrl(current, false);
    let res: Response;
    try {
      res = await fetchFn(current, {
        redirect: 'manual',
        headers: {
          Accept: followPage ? 'image/*,text/html;q=0.8' : 'image/*',
          ...(referer ? { Referer: referer } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      if ((err as Error).name === 'TimeoutError') {
        throw new ImageDownloadError('unreachable', 'The site took too long to answer');
      }
      throw new ImageDownloadError('unreachable', 'Could not reach that site');
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Redirect without location');
      current = new URL(location, current).toString();
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new ImageDownloadError('refused', 'That site does not allow downloading the image');
    }
    if (!res.ok) throw new Error(`Image download failed (HTTP ${res.status})`);
    const type = res.headers.get('content-type') ?? '';
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (followPage && type.startsWith('text/html')) {
      if (declared > MAX_PAGE_BYTES) throw new ImageDownloadError('not_image', 'Page too large');
      const html = Buffer.from(await res.arrayBuffer())
        .subarray(0, MAX_PAGE_BYTES)
        .toString('utf8');
      const image = findPageImage(html, current);
      if (!image) {
        throw new ImageDownloadError('not_image', 'That page has no main picture we can use');
      }
      referer = current;
      current = image;
      followPage = false;
      continue;
    }
    if (type && !type.startsWith('image/') && !type.startsWith('application/octet-stream')) {
      throw new ImageDownloadError('not_image', 'That link is not a picture');
    }
    if (declared > MAX_DOWNLOAD_BYTES) {
      throw new ImageDownloadError('too_large', 'That picture is larger than 10 MB');
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_DOWNLOAD_BYTES) {
      throw new ImageDownloadError('too_large', 'That picture is larger than 10 MB');
    }
    return buffer;
  }
  throw new Error('Too many redirects');
}

export function createPictureStore(mediaDir: string) {
  return {
    /** Decodes (validates), strips metadata, and writes a 480px WebP plus a 96px square thumb. */
    async save(input: Buffer): Promise<StoredImage> {
      const image = sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate();
      const main = await image
        .clone()
        .resize(MAIN_SIZE, MAIN_SIZE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer({ resolveWithObject: true });
      const thumb = await image
        .clone()
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'attention' })
        .webp({ quality: 72 })
        .toBuffer();
      const fileKey = randomBytes(16).toString('hex');
      await mkdir(mediaDir, { recursive: true });
      await writeFile(join(mediaDir, `${fileKey}.webp`), main.data);
      await writeFile(join(mediaDir, `${fileKey}-thumb.webp`), thumb);
      return { fileKey, width: main.info.width, height: main.info.height };
    },
    async read(name: string): Promise<Buffer | null> {
      if (!MEDIA_NAME_RE.test(name)) return null;
      try {
        return await readFile(join(mediaDir, name));
      } catch {
        return null;
      }
    },
  };
}

export type PictureStore = ReturnType<typeof createPictureStore>;
