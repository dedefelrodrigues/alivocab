import { serve } from '@hono/node-server';
import { app } from './app.ts';
import { env } from './env.ts';

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`AliVocab API listening on http://localhost:${info.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
