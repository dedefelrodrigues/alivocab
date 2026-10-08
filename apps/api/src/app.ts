import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { adminRoutes } from './routes/admin.ts';
import { credentialRoutes } from './routes/credentials.ts';
import { generateRoutes } from './routes/generate.ts';
import { health } from './routes/health.ts';
import { meRoutes } from './routes/me.ts';
import { mediaRoutes, pictureRoutes } from './routes/pictures.ts';
import { reviewRoutes } from './routes/review.ts';
import { themeRoutes } from './routes/themes.ts';
import { wordRoutes } from './routes/words.ts';
import type { AppDeps } from './types.ts';

/**
 * Builds the Hono app from its dependencies (DB, auth, crypto), so tests can pass an
 * in-memory database. The web app imports only the *type* (`AppType`) for its RPC client.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono().basePath('/api');

  if (deps.log !== false) app.use(logger());
  app.use(secureHeaders());

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: 'Internal server error' }, 500);
  });
  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.on(['GET', 'POST'], '/auth/*', (c) => deps.auth.handler(c.req.raw));

  return app
    .route('/health', health)
    .route('/me', meRoutes(deps))
    .route('/credentials', credentialRoutes(deps))
    .route('/admin', adminRoutes(deps))
    .route('/generate', generateRoutes(deps))
    .route('/themes', themeRoutes(deps))
    .route('/words', wordRoutes(deps))
    .route('/review', reviewRoutes(deps))
    .route('/pictures', pictureRoutes(deps))
    .route('/media', mediaRoutes(deps));
}

export type AppType = ReturnType<typeof createApp>;
