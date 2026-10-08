import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { assertPublicUrl } from '../net.ts';

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAIN_SIZE = 480;
const THUMB_SIZE = 96;

/** `<32 hex>.webp` or `<32 hex>-thumb.webp`. */
export const MEDIA_NAME_RE = /^([a-f0-9]{32})(-thumb)?\.webp$/;

export type StoredImage = { fileKey: string; width: number; height: number };

/**
 * Downloads an image from a provider URL. Every hop must resolve to a public address (SSRF),
 * redirects are followed manually (max 3) and the body is capped.
 */
export async function downloadImage(url: string, fetchFn: typeof fetch = fetch): Promise<Buffer> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:\/\//.test(current)) throw new Error('Unsupported image URL');
    await assertPublicUrl(current, false);
    const res = await fetchFn(current, {
      redirect: 'manual',
      headers: { 'User-Agent': 'AliVocab/0.1 (self-hosted vocabulary trainer)', Accept: 'image/*' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Redirect without location');
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`Image download failed (HTTP ${res.status})`);
    const type = res.headers.get('content-type') ?? '';
    if (type && !type.startsWith('image/') && !type.startsWith('application/octet-stream')) {
      throw new Error('Not an image');
    }
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_DOWNLOAD_BYTES) throw new Error('Image is too large');
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_DOWNLOAD_BYTES) throw new Error('Image is too large');
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
