import { cpSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/scripts/seed.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so bundle them into the output.
  noExternal: [/^@alivocab\//],
  // Native module: must stay a runtime dependency.
  external: ['better-sqlite3'],
  async onSuccess() {
    cpSync('../../packages/db/drizzle', 'dist/drizzle', { recursive: true });
  },
});
