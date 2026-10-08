import { randomBytes } from 'node:crypto';
import { createTestDb, schema } from '@alivocab/db';
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';
import { createApp } from '../app.ts';
import { createAuth, INVITE_HEADER } from '../auth.ts';
import { createSecretBox } from '../lib/crypto.ts';
import type { AppDeps } from '../types.ts';

export const BASE_URL = 'http://localhost:5180';

export function createTestApp(overrides: Partial<AppDeps> = {}) {
  const db = createTestDb();
  const deps: AppDeps = {
    db,
    auth: createAuth({
      db,
      secret: 'test-secret-'.padEnd(40, 'x'),
      baseURL: BASE_URL,
      rateLimit: false,
    }),
    secretBox: createSecretBox(randomBytes(32).toString('base64')),
    allowPrivateAiBaseUrls: false,
    fetchFn: vi.fn<typeof fetch>(async () => Response.json({ data: [{ id: 'model-a' }] })),
    log: false,
    ...overrides,
  };
  const app = createApp(deps);

  const addInvite = (code: string, values: Partial<typeof schema.inviteCodes.$inferInsert> = {}) =>
    db
      .insert(schema.inviteCodes)
      .values({ code, ...values })
      .run();

  /** Sends a JSON request, optionally authenticated with a session cookie. */
  const call = (
    path: string,
    init: {
      method?: string;
      body?: unknown;
      cookie?: string;
      headers?: Record<string, string>;
    } = {},
  ) =>
    app.request(path, {
      method: init.method ?? 'GET',
      headers: {
        origin: BASE_URL,
        ...init.headers,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

  const signUp = async (email: string, inviteCode?: string) => {
    const res = await call('/api/auth/sign-up/email', {
      method: 'POST',
      body: { name: email.split('@')[0], email, password: 'correct-horse-1' },
      headers: inviteCode ? { [INVITE_HEADER]: inviteCode } : {},
    });
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    return { res, cookie };
  };

  /** Signs up a user with a fresh invite and returns their session cookie. */
  let counter = 0;
  const createUser = async (email: string, role: 'user' | 'admin' = 'user') => {
    const code = `TEST-${++counter}`;
    addInvite(code);
    const { res, cookie } = await signUp(email, code);
    if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
    if (role === 'admin') {
      db.update(schema.user).set({ role: 'admin' }).where(eq(schema.user.email, email)).run();
    }
    return cookie;
  };

  return { app, db, deps, call, signUp, addInvite, createUser };
}
