import { cpSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/scripts/seed.ts', 'src/scripts/backup.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  clean: true,
  // Bundled CommonJS dependencies (e.g. in the AI SDK) call require() for Node built-ins,
  // which an ES module doesn't have.
  banner: {
    js: "import { createRequire as __alivocabRequire } from 'node:module'; const require = __alivocabRequire(import.meta.url);",
  },
  sourcemap: true,
  // Workspace packages ship TypeScript source, so bundle them into the output.
  noExternal: [/^@alivocab\//],
  // Native module, and a CommonJS WebSocket client (ws): runtime dependencies, not bundled.
  external: ['better-sqlite3', 'msedge-tts'],
  async onSuccess() {
    cpSync('../../packages/db/drizzle', 'dist/drizzle', { recursive: true });
  },
});
