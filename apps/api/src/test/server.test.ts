import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServer } from '../server.ts';
import { createTestApp } from './helpers.ts';

function site() {
  const dir = mkdtempSync(join(tmpdir(), 'alivocab-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>AliVocab</title>');
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'sw.js'), 'self.x = 1');
  return createServer(createTestApp().app, dir);
}

describe('serving the web app', () => {
  it('serves files, long-caching only hashed assets', async () => {
    const server = site();
    const asset = await server.request('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const sw = await server.request('/sw.js');
    expect(sw.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers app routes with index.html and keeps the API separate', async () => {
    const server = site();
    const page = await server.request('/themes/abc');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>AliVocab</title>');
    expect(page.headers.get('cache-control')).toBe('no-cache');

    const health = await server.request('/api/health');
    expect(await health.json()).toMatchObject({ status: 'ok' });
    const missing = await server.request('/api/nope');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Not found' });
  });

  it('refuses to start without a built app', () => {
    expect(() =>
      createServer(createTestApp().app, mkdtempSync(join(tmpdir(), 'alivocab-empty-'))),
    ).toThrow(/no index.html/);
  });
});
