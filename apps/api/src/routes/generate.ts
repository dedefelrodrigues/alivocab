import { describeAiError, generateInBatches } from '@alivocab/ai';
import { buildVocabPrompt, parseVocabulary, VOCAB_PROMPT_VERSION } from '@alivocab/core';
import { schema } from '@alivocab/db';
import {
  type AiSource,
  generateRequestSchema,
  importRequestSchema,
  type ProposalDto,
  promptRequestSchema,
} from '@alivocab/shared';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { openModel } from '../lib/ai-model.ts';
import { requestLanguage } from '../lib/languages.ts';
import { rateLimitPerUser } from '../lib/rate-limit.ts';
import { validate } from '../lib/validate.ts';
import { enrichProposal, findOwnedTheme, themeLemmas } from '../lib/vocab.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

const BATCH_SIZE = 25;

export const generateRoutes = (deps: AppDeps) => {
  const { db, auth } = deps;

  /** Languages come from the theme being extended, else the requested (or active) language. */
  const context = (userId: string, themeId?: string, lang?: string) => {
    if (themeId) {
      const theme = findOwnedTheme(db, userId, themeId);
      return {
        lang: theme.targetLang,
        targetLang: theme.targetLang,
        nativeLang: theme.nativeLang,
        avoid: themeLemmas(db, theme.id),
      };
    }
    const language = requestLanguage(db, userId, { lang });
    return {
      lang: language.lang,
      targetLang: language.lang,
      nativeLang: language.nativeLang,
      avoid: [] as string[],
    };
  };

  const logGeneration = (values: {
    userId: string;
    source: AiSource;
    prompt: string;
    rawOutput: string | null;
    parsedOk: boolean;
    provider?: string | null;
    model?: string | null;
    error?: string | null;
    tokensIn?: number | null;
    tokensOut?: number | null;
  }) =>
    db
      .insert(schema.aiGenerations)
      .values({ kind: 'vocab_proposal', promptVersion: VOCAB_PROMPT_VERSION, ...values })
      .returning({ id: schema.aiGenerations.id })
      .get().id;

  return (
    new Hono<AuthedEnv>()
      .use(requireAuth(auth))
      // The prompt for copy-paste and in-browser models.
      .post('/prompt', validate('json', promptRequestSchema), (c) => {
        const input = c.req.valid('json');
        const ctx = context(c.get('user').id, input.themeId, input.lang);
        const prompt = buildVocabPrompt({ ...ctx, ...input });
        return c.json({ prompt, promptVersion: VOCAB_PROMPT_VERSION, avoid: ctx.avoid });
      })
      // Server-side generation with one of the user's API keys.
      .post(
        '/',
        rateLimitPerUser({ max: 20, windowMs: 10 * 60_000 }),
        validate('json', generateRequestSchema),
        async (c) => {
          const userId = c.get('user').id;
          const input = c.req.valid('json');
          const ctx = context(userId, input.themeId, input.lang);
          const { model, provider, modelId, disableReasoning } = await openModel(
            deps,
            userId,
            input.credentialId,
            input.model,
          );

          const parse = (text: string) => parseVocabulary(text, ctx);
          try {
            const result = await generateInBatches({
              model,
              lang: ctx.lang,
              total: input.count,
              batchSize: BATCH_SIZE,
              avoid: ctx.avoid,
              disableReasoning,
              prompt: (count, avoid) =>
                buildVocabPrompt({ ...ctx, ...input, count, avoid, format: 'json' }),
              parse,
            });
            const generationId = logGeneration({
              userId,
              source: 'api',
              provider: provider,
              model: modelId,
              prompt: result.prompts.join('\n\n---\n\n'),
              rawOutput: result.rawOutput,
              parsedOk: result.words.length > 0,
              tokensIn: result.tokensIn,
              tokensOut: result.tokensOut,
            });
            const proposal: ProposalDto = {
              generationId,
              words: enrichProposal(db, userId, ctx.lang, result.words, input.themeId),
              issues: result.issues,
              rawOutput: result.rawOutput,
            };
            return c.json(proposal);
          } catch (err) {
            const message = describeAiError(err);
            logGeneration({
              userId,
              source: 'api',
              provider: provider,
              model: modelId,
              prompt: buildVocabPrompt({ ...ctx, ...input, format: 'json' }),
              rawOutput: null,
              parsedOk: false,
              error: message,
            });
            throw new HTTPException(502, { message });
          }
        },
      )
      // Pasted answers (copy-prompt flow) and in-browser model output.
      .post(
        '/import',
        rateLimitPerUser({ max: 60, windowMs: 10 * 60_000 }),
        validate('json', importRequestSchema),
        (c) => {
          const userId = c.get('user').id;
          const input = c.req.valid('json');
          const ctx = context(userId, input.themeId, input.lang);
          const { words, issues } = parseVocabulary(input.raw, ctx);
          const generationId = logGeneration({
            userId,
            source: input.source,
            model: input.model ?? null,
            prompt: input.prompt ?? '',
            rawOutput: input.raw,
            parsedOk: words.length > 0,
          });
          const proposal: ProposalDto = {
            generationId,
            words: enrichProposal(db, userId, ctx.lang, words, input.themeId),
            issues,
            rawOutput: input.raw,
          };
          return c.json(proposal);
        },
      )
  );
};
