import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { AI_PROVIDER_INFO, type AiProvider } from '@alivocab/shared';
import type { LanguageModel } from 'ai';

export type ModelInput = {
  provider: AiProvider;
  apiKey: string;
  baseUrl?: string | null;
  model?: string | null;
  fetch?: typeof fetch;
};

export function resolveModelId(provider: AiProvider, model?: string | null): string {
  // Providers without a default require a choice: their catalogs change too often to guess.
  const id = model?.trim() || AI_PROVIDER_INFO[provider].defaultModel;
  if (!id)
    throw new Error('Choose a model for this provider (Settings → AI providers → default model)');
  return id;
}

/** Builds an AI SDK language model for a user's credential. */
export function createModel({
  provider,
  apiKey,
  baseUrl,
  model,
  fetch,
}: ModelInput): LanguageModel {
  const id = resolveModelId(provider, model);
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey, fetch })(id);
    case 'openai':
      return createOpenAI({ apiKey, fetch })(id);
    case 'google':
      return createGoogle({ apiKey, fetch })(id);
    case 'deepseek':
      return createDeepSeek({ apiKey, fetch })(id);
    case 'openrouter':
      return createOpenAICompatible({
        name: 'openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
        headers: { 'X-Title': 'AliVocab' },
        fetch,
      }).chatModel(id);
    case 'openai_compat':
      if (!baseUrl) throw new Error('Base URL is required');
      return createOpenAICompatible({
        name: 'openai-compatible',
        baseURL: baseUrl,
        apiKey: apiKey || undefined,
        fetch,
      }).chatModel(id);
  }
}
