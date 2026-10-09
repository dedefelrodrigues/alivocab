import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createDb, MIGRATIONS_DIR, runMigrations } from '@alivocab/db';
import { createAuth } from './auth.ts';
import { allowPrivateAiBaseUrls, databasePath, env, mediaDir } from './env.ts';
import { createSecretBox } from './lib/crypto.ts';
import { createPictureService } from './lib/pictures/service.ts';
import { createPictureStore } from './lib/pictures/store.ts';
import type { AppDeps } from './types.ts';

/**
 * Migrations live in packages/db/drizzle when running from source; the production build copies
 * them next to the bundle (dist/drizzle).
 */
function migrationsFolder(): string {
  const bundled = resolve(import.meta.dirname, 'drizzle');
  return existsSync(bundled) ? bundled : MIGRATIONS_DIR;
}

/** Real dependencies from the environment; applies pending migrations. */
export function createDepsFromEnv(): AppDeps {
  const db = createDb(databasePath);
  runMigrations(db, migrationsFolder());
  return {
    db,
    auth: createAuth({
      db,
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      rateLimit: env.NODE_ENV === 'production',
    }),
    secretBox: createSecretBox(env.APP_ENCRYPTION_KEY),
    pictures: createPictureService({
      db,
      store: createPictureStore(mediaDir),
      pexelsKey: env.PEXELS_API_KEY,
      contact: env.PICTURES_CONTACT,
      log: (msg) => console.warn(`[pictures] ${msg}`),
    }),
    allowPrivateAiBaseUrls,
    audioDir: join(mediaDir, 'tts'),
  };
}
