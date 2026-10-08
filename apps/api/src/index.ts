import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createDepsFromEnv } from './deps.ts';
import { databasePath, env } from './env.ts';

const app = createApp(createDepsFromEnv());

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`AliVocab API listening on http://localhost:${info.port} (db: ${databasePath})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
