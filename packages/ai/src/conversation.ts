import { type LanguageModel, type ModelMessage, streamText } from 'ai';
import { describeAiError } from './errors.ts';

export type ConversationOptions = {
  model: LanguageModel;
  instructions: string;
  messages: ModelMessage[];
  disableReasoning?: boolean;
  maxOutputTokens?: number;
  /** Called with the whole answer once the stream ends (not on errors). */
  onDone: (text: string, usage: { tokensIn: number; tokensOut: number }) => void | Promise<void>;
  onFail?: (message: string) => void;
};

/**
 * Streams one conversational turn as plain text (a `Response` the API can return as is). The
 * finished answer is handed to `onDone` for saving.
 */
export function streamConversation(opts: ConversationOptions): Response {
  const result = streamText({
    model: opts.model,
    instructions: opts.instructions,
    messages: opts.messages,
    temperature: 0.8,
    maxOutputTokens: opts.maxOutputTokens ?? 800,
    maxRetries: 1,
    timeout: 120_000,
    ...(opts.disableReasoning ? { reasoning: 'none' as const } : {}),
    onFinish: async ({ text, totalUsage }) => {
      await opts.onDone(text, {
        tokensIn: totalUsage.inputTokens ?? 0,
        tokensOut: totalUsage.outputTokens ?? 0,
      });
    },
    onError: ({ error }) => opts.onFail?.(describeAiError(error)),
  });
  return result.toTextStreamResponse({
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
