import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type Encrypted = { ciphertext: string; iv: string; tag: string };

/**
 * AES-256-GCM secret box for user API keys. `context` (e.g. the owner's user id) is bound as
 * additional authenticated data, so a ciphertext copied to another user's row fails to decrypt.
 */
export function createSecretBox(base64Key: string) {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');

  return {
    encrypt(plaintext: string, context: string): Encrypted {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
      };
    },

    decrypt(box: Encrypted, context: string): string {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(box.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

export type SecretBox = ReturnType<typeof createSecretBox>;

/** Last 4 visible characters for display, e.g. `…a1B2`. Empty keys stay empty. */
export function keyLast4(key: string): string {
  return key.length >= 8 ? key.slice(-4) : '';
}
