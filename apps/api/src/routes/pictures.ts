import { pictureSearchSchema } from '@alivocab/shared';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { rateLimitPerUser } from '../lib/rate-limit.ts';
import { validate } from '../lib/validate.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

/** Picture search for the picker, and serving stored picture files. */
export const pictureRoutes = ({ auth, pictures }: AppDeps) =>
  new Hono<AuthedEnv>()
    .use(requireAuth(auth))
    .get(
      '/search',
      rateLimitPerUser({ max: 40, windowMs: 10 * 60_000 }),
      validate('query', pictureSearchSchema),
      async (c) => c.json({ results: await pictures.search(c.req.valid('query').q) }),
    );

export const mediaRoutes = ({ auth, pictures }: AppDeps) =>
  new Hono<AuthedEnv>().use(requireAuth(auth)).get('/:name', async (c) => {
    const data = await pictures.read(c.req.param('name'));
    if (!data) throw new HTTPException(404, { message: 'Not found' });
    return c.body(new Uint8Array(data), 200, {
      'Content-Type': 'image/webp',
      // File names are random and never reused.
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
  });
