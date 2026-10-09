import { BATCH_SEPARATOR, dedupeKey } from '@alivocab/core';
import type { ImportIssue, VocabWord } from '@alivocab/shared';
import { APICallError, generateText, type LanguageModel } from 'ai';
import { describeAiError } from './errors.ts';

export type BatchOptions = {
  model: LanguageModel;
  lang: string;
  /** Total number of words wanted. */
  total: number;
  /** Words per model call; smaller batches are more reliable for long lists. */
  batchSize?: number;
  /** Builds the prompt for one batch. */
  prompt: (count: number, avoid: string[]) => string;
  parse: (text: string) => { words: VocabWord[]; issues: ImportIssue[] };
  /** Lemmas to exclude from the start (e.g. already in the theme). */
  avoid?: string[];
  timeoutMs?: number;
  /**
   * Ask the model not to "think" first. Word lists don't need it, and reasoning models
   * (e.g. DeepSeek V4) otherwise spend the whole output budget before answering.
   */
  disableReasoning?: boolean;
};

export type BatchResult = {
  words: VocabWord[];
  issues: ImportIssue[];
  /** All raw answers joined with BATCH_SEPARATOR, so the import parser can re-read them. */
  rawOutput: string;
  prompts: string[];
  tokensIn: number;
  tokensOut: number;
};

const INSTRUCTIONS =
  'You are a precise language-teaching assistant. Follow the requested output format exactly and output nothing else.';

export type AnswerOptions = {
  model: LanguageModel;
  prompt: string;
  maxOutputTokens: number;
  timeoutMs?: number;
  /** See `BatchOptions.disableReasoning`. */
  disableReasoning?: boolean;
  /** Ends the error shown when reasoning used the whole budget ("…returned no words."). */
  emptyHint?: string;
};

/**
 * One model call with the app's instructions. Retries once without the "no reasoning" option if
 * the model rejects it, and turns an empty answer into a clear error.
 */
export async function generateAnswer(
  opts: AnswerOptions,
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const call = (reasoning: 'none' | undefined) =>
    generateText({
      model: opts.model,
      instructions: INSTRUCTIONS,
      prompt: opts.prompt,
      temperature: 0.7,
      maxOutputTokens: opts.maxOutputTokens,
      maxRetries: 1,
      timeout: opts.timeoutMs ?? 180_000,
      ...(reasoning ? { reasoning } : {}),
    });
  let response: Awaited<ReturnType<typeof call>>;
  try {
    response = await call(opts.disableReasoning ? 'none' : undefined);
  } catch (err) {
    // Some models reject "no reasoning"; fall back to their default once.
    if (!opts.disableReasoning || !APICallError.isInstance(err) || err.statusCode !== 400)
      throw err;
    response = await call(undefined);
  }
  if (!response.text.trim()) {
    throw new Error(
      response.finishReason === 'length'
        ? `The model used its whole answer budget on reasoning and ${opts.emptyHint ?? 'returned nothing. Try a non-reasoning model.'}`
        : `The model returned an empty answer (finish reason: ${response.finishReason}).`,
    );
  }
  return {
    text: response.text,
    tokensIn: response.usage.inputTokens ?? 0,
    tokensOut: response.usage.outputTokens ?? 0,
  };
}

/**
 * Generates a word list in sequential batches, feeding each batch's lemmas into the next
 * prompt's avoid list. Stops early when a batch adds nothing new.
 */
export async function generateInBatches(opts: BatchOptions): Promise<BatchResult> {
  const batchSize = opts.batchSize ?? 25;
  const maxRounds = Math.ceil(opts.total / batchSize) + 1;
  const avoid = [...(opts.avoid ?? [])];
  const seen = new Set(opts.avoid?.map((lemma) => lemma.toLocaleLowerCase(opts.lang)));
  const keys = new Set<string>();
  const result: BatchResult = {
    words: [],
    issues: [],
    rawOutput: '',
    prompts: [],
    tokensIn: 0,
    tokensOut: 0,
  };

  for (let round = 1; round <= maxRounds && result.words.length < opts.total; round++) {
    const count = Math.min(batchSize, opts.total - result.words.length);
    const prompt = opts.prompt(count, avoid);
    result.prompts.push(prompt);

    let text: string;
    try {
      const answer = await generateAnswer({
        model: opts.model,
        prompt,
        maxOutputTokens: Math.min(8_000, 300 * count + 600),
        timeoutMs: opts.timeoutMs,
        disableReasoning: opts.disableReasoning,
        emptyHint:
          'returned no words. Try a non-reasoning model (e.g. deepseek-chat) or fewer words.',
      });
      text = answer.text;
      result.tokensIn += answer.tokensIn;
      result.tokensOut += answer.tokensOut;
    } catch (err) {
      // Keep what earlier batches produced; only fail outright on the first call.
      if (!result.words.length) throw err;
      result.issues.push({
        row: null,
        severity: 'warning',
        message: `Stopped after ${result.words.length} words: ${describeAiError(err)}`,
      });
      break;
    }
    result.rawOutput += `${result.rawOutput ? BATCH_SEPARATOR : ''}${text.trim()}`;

    const parsed = opts.parse(text);
    const label = maxRounds > 2 ? `Batch ${round}: ` : '';
    result.issues.push(...parsed.issues.map((i) => ({ ...i, message: `${label}${i.message}` })));

    let added = 0;
    for (const word of parsed.words) {
      const key = dedupeKey(word, opts.lang);
      if (keys.has(key) || seen.has(word.lemma.toLocaleLowerCase(opts.lang))) continue;
      if (result.words.length >= opts.total) break;
      keys.add(key);
      avoid.push(word.lemma);
      result.words.push(word);
      added++;
    }
    if (added === 0) break;
  }

  return result;
}
