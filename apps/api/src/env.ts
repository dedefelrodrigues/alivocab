import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

/** Repo root when running from source (`apps/api/src`). */
const REPO_ROOT = resolve(import.meta.dirname, '../../..');

// Load the repo-root .env in development (production passes real env vars).
const rootEnv = resolve(REPO_ROOT, '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const base64Key32 = z
  .string({ error: 'is required (openssl rand -base64 32)' })
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3180),
  DATABASE_URL: z.string().default('./data/alivocab.db'),
  APP_ENCRYPTION_KEY: base64Key32,
  BETTER_AUTH_SECRET: z.string({ error: 'is required' }).min(32, 'must be at least 32 chars'),
  BETTER_AUTH_URL: z.url().default('http://localhost:5180'),
  ALLOW_PRIVATE_AI_BASE_URLS: z.stringbool().optional(),
  ADMIN_EMAIL: z.email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    console.error(`Invalid environment configuration:\n${issues.join('\n')}\nSee .env.example.`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

/** Relative DATABASE_URLs are resolved against the repo root, not the cwd. */
export const databasePath =
  env.DATABASE_URL === ':memory:' || isAbsolute(env.DATABASE_URL)
    ? env.DATABASE_URL
    : resolve(REPO_ROOT, env.DATABASE_URL);

export const allowPrivateAiBaseUrls =
  env.ALLOW_PRIVATE_AI_BASE_URLS ?? env.NODE_ENV !== 'production';
