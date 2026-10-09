import { createModel, resolveModelId } from '@alivocab/ai';
import { schema } from '@alivocab/db';
import { desc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { AppDeps } from '../types.ts';
import { decryptKey, findOwnedCredential } from './credentials.ts';
import { assertPublicUrl } from './net.ts';
import { getOrCreateProfile } from './profile.ts';

/** A language model from one of the user's saved API keys (checked base URL, resolved model). */
export async function openModel(
  deps: AppDeps,
  userId: string,
  credentialId: string,
  requestedModel?: string,
) {
  const credential = findOwnedCredential(deps.db, userId, credentialId);
  if (credential.baseUrl) {
    try {
      await assertPublicUrl(credential.baseUrl, deps.allowPrivateAiBaseUrls);
    } catch (err) {
      throw new HTTPException(400, { message: (err as Error).message });
    }
  }
  let modelId: string;
  try {
    modelId = resolveModelId(credential.provider, requestedModel ?? credential.defaultModel);
  } catch (err) {
    throw new HTTPException(400, { message: (err as Error).message });
  }
  const model = (deps.modelFactory ?? createModel)({
    provider: credential.provider,
    apiKey: decryptKey(deps.secretBox, credential, userId),
    baseUrl: credential.baseUrl,
    model: modelId,
    fetch: deps.fetchFn,
  });
  return {
    model,
    provider: credential.provider,
    modelId,
    // Generic OpenAI-compatible servers may reject reasoning parameters.
    disableReasoning: credential.provider !== 'openai_compat',
  };
}

/**
 * The API key to use when the learner didn't pick one: the default AI source from Settings if it
 * is a key, else their newest key. 400 when they have none.
 */
export function defaultCredentialId(deps: AppDeps, userId: string, requested?: string): string {
  if (requested) return requested;
  const { db } = deps;
  const source = getOrCreateProfile(db, userId).defaultAiSource;
  const own = db
    .select({ id: schema.aiCredentials.id })
    .from(schema.aiCredentials)
    .where(eq(schema.aiCredentials.userId, userId))
    .orderBy(desc(schema.aiCredentials.createdAt))
    .all();
  const preferred = source.startsWith('api:') ? source.slice(4) : null;
  const id = own.find((c) => c.id === preferred)?.id ?? own[0]?.id;
  if (!id) {
    throw new HTTPException(400, {
      message: 'Add an API key in Settings → AI providers to use this.',
    });
  }
  return id;
}
