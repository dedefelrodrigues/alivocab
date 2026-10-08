import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { Auth } from '../auth.ts';
import type { AuthedEnv } from '../types.ts';

/** Resolves the Better Auth session from cookies; 401 if missing or banned. */
export const requireAuth = (auth: Auth) =>
  createMiddleware<AuthedEnv>(async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result) throw new HTTPException(401, { message: 'Not signed in' });
    c.set('user', result.user);
    c.set('session', result.session);
    await next();
  });

/** Must run after `requireAuth`. */
export const requireAdmin = createMiddleware<AuthedEnv>(async (c, next) => {
  if (c.get('user').role !== 'admin') throw new HTTPException(403, { message: 'Admins only' });
  await next();
});
