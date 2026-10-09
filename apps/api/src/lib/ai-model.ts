import { createModel, resolveModelId } from '@alivocab/ai';
import { HTTPException } from 'hono/http-exception';
import type { AppDeps } from '../types.ts';
import { decryptKey, findOwnedCredential } from './credentials.ts';
import { assertPublicUrl } from './net.ts';

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
