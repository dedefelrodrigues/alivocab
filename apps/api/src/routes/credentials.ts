import { testCredential } from '@alivocab/ai';
import { schema } from '@alivocab/db';
import {
  type CredentialDto,
  type CredentialTestResult,
  credentialCreateSchema,
  credentialUpdateSchema,
} from '@alivocab/shared';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { decryptKey, findOwnedCredential } from '../lib/credentials.ts';
import { keyLast4 } from '../lib/crypto.ts';
import { assertPublicUrl } from '../lib/net.ts';
import { validate } from '../lib/validate.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

const { aiCredentials, userProfiles } = schema;
type Row = typeof aiCredentials.$inferSelect;

function toDto(row: Row): CredentialDto {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    baseUrl: row.baseUrl,
    defaultModel: row.defaultModel,
    keyLast4: row.keyLast4,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestOk: row.lastTestOk,
    createdAt: row.createdAt.toISOString(),
  };
}

export const credentialRoutes = (deps: AppDeps) => {
  const { db, auth, secretBox, allowPrivateAiBaseUrls } = deps;

  const checkBaseUrl = async (baseUrl: string | null | undefined) => {
    if (!baseUrl) return;
    try {
      await assertPublicUrl(baseUrl, allowPrivateAiBaseUrls);
    } catch (err) {
      throw new HTTPException(400, { message: (err as Error).message });
    }
  };

  const findOwned = (userId: string, id: string) => findOwnedCredential(db, userId, id);

  const runTest = async (
    input: Parameters<typeof testCredential>[0],
  ): Promise<CredentialTestResult> => {
    try {
      await assertPublicUrl(input.baseUrl ?? 'https://example.com', allowPrivateAiBaseUrls);
    } catch (err) {
      return { ok: false, message: (err as Error).message, models: [] };
    }
    return testCredential(input, deps.fetchFn);
  };

  return (
    new Hono<AuthedEnv>()
      .use(requireAuth(auth))
      .get('/', (c) => {
        const rows = db
          .select()
          .from(aiCredentials)
          .where(eq(aiCredentials.userId, c.get('user').id))
          .orderBy(desc(aiCredentials.createdAt))
          .all();
        return c.json(rows.map(toDto));
      })
      // Test a key before saving it.
      .post('/test', validate('json', credentialCreateSchema), async (c) => {
        const { provider, apiKey, baseUrl } = c.req.valid('json');
        return c.json(await runTest({ provider, apiKey, baseUrl }));
      })
      .post('/', validate('json', credentialCreateSchema), async (c) => {
        const userId = c.get('user').id;
        const input = c.req.valid('json');
        await checkBaseUrl(input.baseUrl);
        const box = secretBox.encrypt(input.apiKey, userId);
        const row = db
          .insert(aiCredentials)
          .values({
            userId,
            provider: input.provider,
            label: input.label,
            baseUrl: input.baseUrl ?? null,
            defaultModel: input.defaultModel || null,
            keyCiphertext: box.ciphertext,
            keyIv: box.iv,
            keyTag: box.tag,
            keyLast4: keyLast4(input.apiKey),
          })
          .returning()
          .get();
        return c.json(toDto(row), 201);
      })
      .patch('/:id', validate('json', credentialUpdateSchema), async (c) => {
        const userId = c.get('user').id;
        const existing = findOwned(userId, c.req.param('id'));
        const { apiKey, ...rest } = c.req.valid('json');
        await checkBaseUrl(rest.baseUrl);
        const keyFields = apiKey
          ? (() => {
              const box = secretBox.encrypt(apiKey, userId);
              return {
                keyCiphertext: box.ciphertext,
                keyIv: box.iv,
                keyTag: box.tag,
                keyLast4: keyLast4(apiKey),
                lastTestedAt: null,
                lastTestOk: null,
              };
            })()
          : {};
        const row = db
          .update(aiCredentials)
          .set({ ...rest, ...keyFields })
          .where(eq(aiCredentials.id, existing.id))
          .returning()
          .get();
        return c.json(toDto(row));
      })
      .delete('/:id', (c) => {
        const userId = c.get('user').id;
        const existing = findOwned(userId, c.req.param('id'));
        db.transaction((tx) => {
          tx.delete(aiCredentials).where(eq(aiCredentials.id, existing.id)).run();
          tx.update(userProfiles)
            .set({ defaultAiSource: 'manual' })
            .where(
              and(
                eq(userProfiles.userId, userId),
                eq(userProfiles.defaultAiSource, `api:${existing.id}`),
              ),
            )
            .run();
        });
        return c.body(null, 204);
      })
      .post('/:id/test', async (c) => {
        const userId = c.get('user').id;
        const row = findOwned(userId, c.req.param('id'));
        const apiKey = decryptKey(secretBox, row, userId);
        const result = await runTest({ provider: row.provider, apiKey, baseUrl: row.baseUrl });
        db.update(aiCredentials)
          .set({ lastTestedAt: new Date(), lastTestOk: result.ok })
          .where(eq(aiCredentials.id, row.id))
          .run();
        return c.json(result);
      })
  );
};
