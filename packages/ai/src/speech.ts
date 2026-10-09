import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { CLOUD_TTS, type CloudTtsProvider, languageName } from '@alivocab/shared';
import { experimental_generateSpeech as generateSpeech, type SpeechModel } from 'ai';

export type SpeechModelInput = {
  provider: CloudTtsProvider;
  apiKey: string;
  fetch?: typeof fetch;
};

/** The speech model used for a cloud TTS provider (see CLOUD_TTS). */
export function createSpeechModel({ provider, apiKey, fetch }: SpeechModelInput): SpeechModel {
  const model = CLOUD_TTS[provider].model;
  return provider === 'openai'
    ? createOpenAI({ apiKey, fetch }).speech(model)
    : createGoogle({ apiKey, fetch }).speech(model);
}

export type SynthesizeInput = {
  model: SpeechModel;
  provider: CloudTtsProvider;
  text: string;
  lang: string;
  voice: string;
};

/** Speaks `text` in `lang`; returns the audio bytes and their media type. */
export async function synthesize(
  input: SynthesizeInput,
): Promise<{ audio: Uint8Array; mediaType: string }> {
  const language = languageName(input.lang);
  const result = await generateSpeech({
    model: input.model,
    text: input.text,
    voice: input.voice,
    language: input.lang,
    // OpenAI follows these; Gemini reads the language from the text.
    instructions: `Read this ${language} text aloud as a native speaker, clearly and at a natural pace for a language learner.`,
    ...(input.provider === 'openai' ? { outputFormat: 'mp3' } : {}),
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(60_000),
  });
  return { audio: result.audio.uint8Array, mediaType: result.audio.mediaType };
}
