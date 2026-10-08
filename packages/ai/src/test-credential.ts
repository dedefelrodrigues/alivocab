import type { AiProvider, CredentialTestResult } from '@alivocab/shared';

export type CredentialInput = {
  provider: AiProvider;
  apiKey: string;
  baseUrl?: string | null;
};

type ModelListSpec = {
  url: string;
  headers: Record<string, string>;
  pick: (body: unknown) => string[];
};

const OPENAI_STYLE = (body: unknown) =>
  ((body as { data?: Array<{ id?: unknown }> }).data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string');

function spec({ provider, apiKey, baseUrl }: CredentialInput): ModelListSpec {
  const bearer: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  switch (provider) {
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models?limit=100',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        pick: OPENAI_STYLE,
      };
    case 'openai':
      return { url: 'https://api.openai.com/v1/models', headers: bearer, pick: OPENAI_STYLE };
    case 'deepseek':
      return { url: 'https://api.deepseek.com/models', headers: bearer, pick: OPENAI_STYLE };
    case 'openrouter':
      // /models is public, so validate the key against an authenticated endpoint first (see below).
      return { url: 'https://openrouter.ai/api/v1/models', headers: bearer, pick: OPENAI_STYLE };
    case 'google':
      return {
        url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
        headers: { 'x-goog-api-key': apiKey },
        pick: (body) =>
          (
            (
              body as {
                models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
              }
            ).models ?? []
          )
            .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
            .map((m) => m.name?.replace(/^models\//, ''))
            .filter((id): id is string => !!id),
      };
    case 'openai_compat':
      if (!baseUrl) throw new Error('Base URL is required');
      return { url: `${baseUrl}/models`, headers: bearer, pick: OPENAI_STYLE };
  }
}

async function getJson(
  fetchFn: typeof fetch,
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await fetchFn(url, { headers, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Could not reach the provider (${reason})` };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: 'The provider rejected this API key' };
  }
  if (!res.ok) return { ok: false, message: `Provider returned HTTP ${res.status}` };
  try {
    return { ok: true, body: await res.json() };
  } catch {
    return { ok: false, message: 'Provider returned a non-JSON response' };
  }
}

/**
 * Checks a credential by listing the provider's models (no tokens spent).
 * Returns model ids so the UI can suggest a default model.
 */
export async function testCredential(
  input: CredentialInput,
  fetchFn: typeof fetch = fetch,
): Promise<CredentialTestResult> {
  if (input.provider === 'openrouter') {
    const key = await getJson(fetchFn, 'https://openrouter.ai/api/v1/key', {
      Authorization: `Bearer ${input.apiKey}`,
    });
    if (!key.ok) return { ok: false, message: key.message, models: [] };
  }

  const s = spec(input);
  const result = await getJson(fetchFn, s.url, s.headers);
  if (!result.ok) return { ok: false, message: result.message, models: [] };

  const models = s.pick(result.body).sort((a, b) => a.localeCompare(b));
  return {
    ok: true,
    message: models.length
      ? `Connected: ${models.length} models available`
      : 'Connected (no models listed)',
    models,
  };
}
