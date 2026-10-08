import { dedupeKey } from '@alivocab/core';
import type { ImportIssue, VocabWord } from '@alivocab/shared';
import { generateText, type LanguageModel } from 'ai';
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
};

export type BatchResult = {
  words: VocabWord[];
  issues: ImportIssue[];
  /** All raw answers, each wrapped in a ``` fence so the import parser can re-read them. */
  rawOutput: string;
  prompts: string[];
  tokensIn: number;
  tokensOut: number;
};

const INSTRUCTIONS =
  'You are a precise language-teaching assistant. Follow the requested output format exactly and output nothing else.';

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
    let usage: { inputTokens?: number; outputTokens?: number };
    try {
      ({ text, usage } = await generateText({
        model: opts.model,
        instructions: INSTRUCTIONS,
        prompt,
        temperature: 0.7,
        maxOutputTokens: Math.min(16_000, 350 * count + 600),
        maxRetries: 1,
        timeout: opts.timeoutMs ?? 120_000,
      }));
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
    result.tokensIn += usage.inputTokens ?? 0;
    result.tokensOut += usage.outputTokens ?? 0;
    result.rawOutput += `${result.rawOutput ? '\n\n' : ''}\`\`\`\n${text.trim()}\n\`\`\``;

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
