import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { logger as prettyLogger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { activityLogger } from './lib/activity.ts';
import { logger } from './lib/logger.ts';
import { adminRoutes } from './routes/admin.ts';
import { credentialRoutes } from './routes/credentials.ts';
import { generateRoutes } from './routes/generate.ts';
import { healthRoutes } from './routes/health.ts';
import { languageRoutes } from './routes/languages.ts';
import { lessonRoutes } from './routes/lessons.ts';
import { logRoutes } from './routes/logs.ts';
import { materialRoutes } from './routes/materials.ts';
import { meRoutes } from './routes/me.ts';
import { mediaRoutes, pictureRoutes } from './routes/pictures.ts';
import { reviewRoutes } from './routes/review.ts';
import { roleplayRoutes } from './routes/roleplay.ts';
import { statsRoutes } from './routes/stats.ts';
import { themeRoutes } from './routes/themes.ts';
import { ttsRoutes } from './routes/tts.ts';
import { wordRoutes } from './routes/words.ts';
import type { AppDeps, AuthUser } from './types.ts';

/** One JSON line per request (health checks excluded: Docker polls them). */
const jsonRequestLog = createMiddleware<{ Variables: { user?: AuthUser } }>(async (c, next) => {
  const started = performance.now();
  await next();
  if (c.req.path === '/api/health') return;
  logger.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
      user: c.get('user')?.id,
    },
    'request',
  );
});

/**
 * Builds the Hono app from its dependencies (DB, auth, crypto), so tests can pass an
 * in-memory database. The web app imports only the *type* (`AppType`) for its RPC client.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono().basePath('/api');

  const log = deps.log ?? 'pretty';
  if (log === 'pretty') app.use(prettyLogger());
  if (log === 'json') app.use(jsonRequestLog);
  app.use(secureHeaders());
  app.use(activityLogger(deps.db));

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    logger.error({ err, method: c.req.method, path: c.req.path }, 'unhandled error');
    return c.json({ error: 'Internal server error' }, 500);
  });
  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.on(['GET', 'POST'], '/auth/*', (c) => deps.auth.handler(c.req.raw));

  return app
    .route('/health', healthRoutes(deps))
    .route('/me', meRoutes(deps))
    .route('/languages', languageRoutes(deps))
    .route('/credentials', credentialRoutes(deps))
    .route('/admin', adminRoutes(deps))
    .route('/generate', generateRoutes(deps))
    .route('/themes', themeRoutes(deps))
    .route('/words', wordRoutes(deps))
    .route('/review', reviewRoutes(deps))
    .route('/lessons', lessonRoutes(deps))
    .route('/materials', materialRoutes(deps))
    .route('/roleplay', roleplayRoutes(deps))
    .route('/stats', statsRoutes(deps))
    .route('/logs', logRoutes(deps))
    .route('/tts', ttsRoutes(deps))
    .route('/pictures', pictureRoutes(deps))
    .route('/media', mediaRoutes(deps));
}

export type AppType = ReturnType<typeof createApp>;
