import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { admin } from 'better-auth/plugins';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';

export type AuthOptions = {
  db: Db;
  secret: string;
  baseURL: string;
  /** Turn on Better Auth's built-in rate limiter (production). */
  rateLimit: boolean;
};

/** Request header carrying the invite code on `POST /api/auth/sign-up/email`. */
export const INVITE_HEADER = 'x-invite-code';

/** Endpoints allowed to create users without an invite code (admin-only by plugin). */
const INVITE_EXEMPT_PATHS = new Set(['/admin/create-user']);

/**
 * Atomically consumes one use of an invite code. Returns false if the code is unknown,
 * used up, expired or revoked.
 */
export function consumeInvite(db: Db, code: string): boolean {
  const { inviteCodes } = schema;
  const now = new Date();
  const updated = db
    .update(inviteCodes)
    .set({ uses: sql`${inviteCodes.uses} + 1` })
    .where(
      and(
        eq(inviteCodes.code, code.trim()),
        lt(inviteCodes.uses, inviteCodes.maxUses),
        isNull(inviteCodes.revokedAt),
        or(isNull(inviteCodes.expiresAt), gt(inviteCodes.expiresAt, now)),
      ),
    )
    .returning({ id: inviteCodes.id })
    .all();
  return updated.length === 1;
}

export function createAuth({ db, secret, baseURL, rateLimit }: AuthOptions) {
  return betterAuth({
    appName: 'AliVocab',
    secret,
    baseURL,
    basePath: '/api/auth',
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh daily
    },
    rateLimit: { enabled: rateLimit },
    plugins: [admin()],
    databaseHooks: {
      user: {
        create: {
          // Invite gate: sign-up requires a valid code in the `x-invite-code` header.
          before: async (_user, ctx) => {
            if (ctx && INVITE_EXEMPT_PATHS.has(ctx.path)) return;
            const code = ctx?.headers?.get(INVITE_HEADER) ?? '';
            if (!code || !consumeInvite(db, code)) {
              throw new APIError('FORBIDDEN', {
                code: 'INVALID_INVITE',
                message: 'A valid invite code is required to create an account',
              });
            }
          },
          after: async (user) => {
            db.insert(schema.userProfiles).values({ userId: user.id }).onConflictDoNothing().run();
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
