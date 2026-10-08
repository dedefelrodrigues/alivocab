import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { health } from './routes/health.ts';

/**
 * The Hono app. Kept free of Node-only APIs so the web app can import its *type* for the
 * typed RPC client (`hc<AppType>`), and tests can call `app.request()` directly.
 */
export const app = new Hono()
  .basePath('/api')
  .use(logger())
  .use(secureHeaders())
  .route('/health', health);

export type AppType = typeof app;
