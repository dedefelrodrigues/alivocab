import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { createApp } from './app.ts';

/** Vite puts hashed bundles here: their names change with their content. */
const IMMUTABLE = /^\/assets\//;

/**
 * The whole site: the API under /api and, in production, the built web app (one process,
 * one port). Unknown non-API paths get index.html so the app's router can handle them.
 */
export function createServer(api: ReturnType<typeof createApp>, staticDir?: string) {
  const server = new Hono();
  server.route('/', api);
  if (!staticDir) return server;
  if (!existsSync(join(staticDir, 'index.html'))) {
    throw new Error(`STATIC_DIR has no index.html: ${staticDir}`);
  }

  // (serveStatic's onFound runs too late to set headers, so they're set on its response.)
  const cached = (res: unknown, path: string) => {
    // When the file is missing, serveStatic passes on to the next handler (no response here).
    if (!(res instanceof Response)) return undefined;
    // index.html, the service worker and the manifest must be revalidated to pick up releases.
    res.headers.set(
      'Cache-Control',
      IMMUTABLE.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
    return res;
  };
  const files = serveStatic({ root: staticDir });
  const app = serveStatic({ path: join(staticDir, 'index.html') });
  server.use('*', async (c, next) => {
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) return next();
    return cached(await files(c, next), c.req.path);
  });
  server.get('*', async (c, next) => {
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) return next();
    return cached(await app(c, next), '/index.html');
  });
  server.notFound((c) => c.json({ error: 'Not found' }, 404));
  return server;
}
