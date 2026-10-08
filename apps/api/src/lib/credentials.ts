import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { SecretBox } from './crypto.ts';

export type CredentialRow = typeof schema.aiCredentials.$inferSelect;

/** Loads a credential owned by the user, or 404 (never reveals other users' ids). */
export function findOwnedCredential(db: Db, userId: string, id: string): CredentialRow {
  const row = db
    .select()
    .from(schema.aiCredentials)
    .where(and(eq(schema.aiCredentials.id, id), eq(schema.aiCredentials.userId, userId)))
    .get();
  if (!row) throw new HTTPException(404, { message: 'Credential not found' });
  return row;
}

export function decryptKey(secretBox: SecretBox, row: CredentialRow, userId: string): string {
  return secretBox.decrypt(
    { ciphertext: row.keyCiphertext, iv: row.keyIv, tag: row.keyTag },
    userId,
  );
}
