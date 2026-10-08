import { parseVocabulary } from '@alivocab/core';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { generateInBatches } from './generate-vocab.ts';

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 50, text: 50, reasoning: undefined },
};

function mockModel(answers: string[]) {
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: answers[call++] ?? '{"words":[]}' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage,
      warnings: [],
    }),
  });
}

const word = (lemma: string) => ({ lemma, pos: 'noun', translations: [`${lemma}-en`] });
const answer = (...lemmas: string[]) => JSON.stringify({ words: lemmas.map(word) });
const parse = (text: string) => parseVocabulary(text, { lang: 'pl', nativeLang: 'en' });

describe('generateInBatches', () => {
  it('splits large requests and feeds earlier lemmas into the avoid list', async () => {
    const prompts: Array<{ count: number; avoid: string[] }> = [];
    const result = await generateInBatches({
      model: mockModel([answer('a', 'b'), answer('b', 'c', 'd'), answer('e')]),
      lang: 'pl',
      total: 5,
      batchSize: 2,
      avoid: ['zzz'],
      prompt: (count, avoid) => {
        prompts.push({ count, avoid: [...avoid] });
        return `give ${count}`;
      },
      parse,
    });

    expect(result.words.map((w) => w.lemma)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(prompts[0]).toEqual({ count: 2, avoid: ['zzz'] });
    expect(prompts[1]).toEqual({ count: 2, avoid: ['zzz', 'a', 'b'] });
    expect(prompts[2]).toEqual({ count: 1, avoid: ['zzz', 'a', 'b', 'c', 'd'] });
    expect(result.tokensIn).toBe(300);
    expect(parse(result.rawOutput).words).toHaveLength(5);
  });

  it('stops when a batch adds nothing new and skips avoided words', async () => {
    const result = await generateInBatches({
      model: mockModel([answer('zzz', 'a'), answer('a')]),
      lang: 'pl',
      total: 10,
      batchSize: 5,
      avoid: ['zzz'],
      prompt: (count) => `give ${count}`,
      parse,
    });
    expect(result.words.map((w) => w.lemma)).toEqual(['a']);
    expect(result.prompts).toHaveLength(2);
  });

  it('returns partial results when a later batch fails', async () => {
    let call = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        if (call++ > 0) throw new Error('boom');
        return {
          content: [{ type: 'text', text: answer('a', 'b') }],
          finishReason: { unified: 'stop', raw: undefined },
          usage,
          warnings: [],
        };
      },
    });
    const result = await generateInBatches({
      model,
      lang: 'pl',
      total: 4,
      batchSize: 2,
      prompt: (count) => `give ${count}`,
      parse,
    });
    expect(result.words).toHaveLength(2);
    expect(result.issues.at(-1)?.message).toMatch(/^Stopped after 2 words/);
  });

  it('throws when the first call fails', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('bad key');
      },
    });
    await expect(
      generateInBatches({ model, lang: 'pl', total: 2, prompt: () => 'p', parse }),
    ).rejects.toThrow();
  });
});
