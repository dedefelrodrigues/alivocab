import { describe, expect, it } from 'vitest';
import { createTestApp } from '../test/helpers.ts';

describe('GET /api/health', () => {
  it('returns ok with security headers', async () => {
    const { call } = createTestApp();
    const res = await call('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'alivocab-api' });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('answers unknown API paths with JSON 404', async () => {
    const { call } = createTestApp();
    const res = await call('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
