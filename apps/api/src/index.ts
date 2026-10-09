import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createDepsFromEnv } from './deps.ts';
import { backupDir, databasePath, env, staticDir } from './env.ts';
import { scheduleBackups } from './lib/backup.ts';
import { logger } from './lib/logger.ts';
import { createServer } from './server.ts';

const deps = createDepsFromEnv();
const site = createServer(createApp(deps), staticDir);

const stopBackups =
  env.NODE_ENV === 'production' && env.BACKUP_KEEP_DAYS > 0
    ? scheduleBackups(deps.db, {
        dir: backupDir,
        keepDays: env.BACKUP_KEEP_DAYS,
        hour: env.BACKUP_HOUR,
      })
    : () => {};

const server = serve({ fetch: site.fetch, port: env.PORT }, (info) => {
  logger.info(
    { port: info.port, db: databasePath, web: staticDir ?? null, env: env.NODE_ENV },
    `AliVocab listening on http://localhost:${info.port}`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopBackups();
    server.close(() => {
      deps.db.$client.close();
      process.exit(0);
    });
    // Streams (role-play) can keep connections open; don't hang the container on shutdown.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
