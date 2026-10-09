import { type LanguageModel, type ModelMessage, streamText } from 'ai';
import { describeAiError } from './errors.ts';

export type ConversationOptions = {
  model: LanguageModel;
  instructions: string;
  messages: ModelMessage[];
  disableReasoning?: boolean;
  maxOutputTokens?: number;
  /**
   * Called with the whole answer once the model is done, before the stream closes (so a client
   * that reloads after the end sees what was saved). Not called on errors.
   */
  onDone: (text: string, usage: { tokensIn: number; tokensOut: number }) => void | Promise<void>;
  onFail?: (message: string) => void;
};

/** Appended to the stream when the turn failed, so the client can tell it apart from a reply. */
export const STREAM_ERROR_TAG = 'stream-error';

/**
 * Streams one conversational turn as plain text (a `Response` the API can return as is). The
 * finished answer is handed to `onDone` for saving. If the model fails (or saving does), the
 * stream ends with `<stream-error>message</stream-error>` instead of closing silently.
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
    // Errors arrive as `error` parts below and go to `onFail` (instead of the console).
    onError: () => {},
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false; // The client went away; keep going so the turn still gets saved.
        }
      };
      let text = '';
      let failure: string | null = null;
      let usage = { tokensIn: 0, tokensOut: 0 };
      try {
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            text += part.text;
            send(part.text);
          } else if (part.type === 'error') {
            failure ??= describeAiError(part.error);
          } else if (part.type === 'finish') {
            usage = {
              tokensIn: part.totalUsage.inputTokens ?? 0,
              tokensOut: part.totalUsage.outputTokens ?? 0,
            };
          }
        }
        if (!failure && !text.trim()) failure = 'The model sent an empty answer.';
        if (!failure) await opts.onDone(text, usage);
      } catch (err) {
        failure ??= describeAiError(err);
      }
      if (failure) {
        opts.onFail?.(failure);
        send(`\n<${STREAM_ERROR_TAG}>${failure}</${STREAM_ERROR_TAG}>`);
      }
      if (open) controller.close();
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
