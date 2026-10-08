/**
 * Dev/bootstrap seed: creates the first admin (ADMIN_EMAIL / ADMIN_PASSWORD) through the normal
 * invite-gated sign-up, then prints one fresh invite code. Safe to re-run.
 */
import { schema } from '@alivocab/db';
import { eq } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import { INVITE_HEADER } from '../auth.ts';
import { createDepsFromEnv } from '../deps.ts';
import { env } from '../env.ts';

const code = () => `ALI-${customAlphabet('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 8)()}`;
const { db, auth } = createDepsFromEnv();

if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first.');
  process.exit(1);
}

const existing = db.select().from(schema.user).where(eq(schema.user.email, env.ADMIN_EMAIL)).get();
if (existing) {
  console.log(`Admin ${env.ADMIN_EMAIL} already exists.`);
} else {
  const bootstrap = code();
  db.insert(schema.inviteCodes).values({ code: bootstrap, note: 'seed: admin bootstrap' }).run();
  const { user } = await auth.api.signUpEmail({
    body: {
      name: 'Admin',
      email: env.ADMIN_EMAIL,
      password: env.ADMIN_PASSWORD,
    },
    headers: new Headers({ [INVITE_HEADER]: bootstrap }),
  });
  db.update(schema.user).set({ role: 'admin' }).where(eq(schema.user.id, user.id)).run();
  console.log(`Created admin ${env.ADMIN_EMAIL} (password from .env).`);
}

const invite = code();
db.insert(schema.inviteCodes)
  .values({ code: invite, note: 'seed', expiresAt: new Date(Date.now() + 14 * 86_400_000) })
  .run();
console.log(`New invite code (14 days, 1 use): ${invite}`);
