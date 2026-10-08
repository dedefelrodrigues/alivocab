import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSecretBox, keyLast4 } from './crypto.ts';

const box = createSecretBox(randomBytes(32).toString('base64'));

describe('secret box', () => {
  it('round-trips', () => {
    const enc = box.encrypt('sk-ant-secret-ŁÓDŹ', 'user-1');
    expect(enc.ciphertext).not.toContain('secret');
    expect(box.decrypt(enc, 'user-1')).toBe('sk-ant-secret-ŁÓDŹ');
  });

  it('uses a fresh IV each time', () => {
    expect(box.encrypt('same', 'u').iv).not.toBe(box.encrypt('same', 'u').iv);
  });

  it('rejects a ciphertext bound to another user', () => {
    const enc = box.encrypt('secret', 'user-1');
    expect(() => box.decrypt(enc, 'user-2')).toThrow();
  });

  it('rejects tampered ciphertext', () => {
    const enc = box.encrypt('secret', 'user-1');
    const bytes = Buffer.from(enc.ciphertext, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    expect(() => box.decrypt({ ...enc, ciphertext: bytes.toString('base64') }, 'user-1')).toThrow();
  });

  it('rejects a different key', () => {
    const other = createSecretBox(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(box.encrypt('secret', 'u'), 'u')).toThrow();
  });

  it('requires a 32-byte key', () => {
    expect(() => createSecretBox(randomBytes(16).toString('base64'))).toThrow();
  });
});

describe('keyLast4', () => {
  it('shows the last 4 chars of real keys only', () => {
    expect(keyLast4('sk-1234567890abcd')).toBe('abcd');
    expect(keyLast4('')).toBe('');
  });
});
