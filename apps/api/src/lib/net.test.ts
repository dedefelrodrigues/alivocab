import { describe, expect, it } from 'vitest';
import { assertPublicUrl, isPrivateAddress } from './net.ts';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('%s is private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111'])('%s is public', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('assertPublicUrl', () => {
  it('blocks private IP literals when not allowed', async () => {
    await expect(assertPublicUrl('http://127.0.0.1:11434/v1', false)).rejects.toThrow();
    await expect(assertPublicUrl('http://[::1]/v1', false)).rejects.toThrow();
  });

  it('allows anything when private targets are allowed', async () => {
    await expect(assertPublicUrl('http://127.0.0.1:11434/v1', true)).resolves.toBeUndefined();
  });

  it('allows public IP literals', async () => {
    await expect(assertPublicUrl('https://1.1.1.1/v1', false)).resolves.toBeUndefined();
  });
});
