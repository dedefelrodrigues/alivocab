import { describeAiError, generateAnswer } from '@alivocab/ai';
import {
  buildTranslationCheckPrompt,
  parseTranslationCheck,
  TRANSLATION_CHECK_PROMPT_VERSION,
} from '@alivocab/core';
import { schema } from '@alivocab/db';
import {
  lessonQuerySchema,
  practiceResultSchema,
  translationCheckRequestSchema,
} from '@alivocab/shared';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { defaultCredentialId, openModel } from '../lib/ai-model.ts';
import { buildLesson, recordPractice } from '../lib/lessons.ts';
import { rateLimitPerUser } from '../lib/rate-limit.ts';
import { validate } from '../lib/validate.ts';
import { findOwnedTheme } from '../lib/vocab.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

/** Mixed-exercise lessons. Graded answers go to `POST /api/review/cards/:cardId`. */
export const lessonRoutes = (deps: AppDeps) => {
  const { db, auth } = deps;
  return (
    new Hono<AuthedEnv>()
      .use(requireAuth(auth))
      .get('/', validate('query', lessonQuerySchema), (c) => {
        const userId = c.get('user').id;
        const query = c.req.valid('query');
        if (query.themeId) findOwnedTheme(db, userId, query.themeId);
        return c.json(buildLesson(db, userId, query));
      })
      .post('/practice', validate('json', practiceResultSchema), (c) => {
        recordPractice(db, c.get('user').id, c.req.valid('json'));
        return c.json({ ok: true });
      })
      // "Ask AI" for a translation the free check couldn't confirm.
      .post(
        '/check-translation',
        rateLimitPerUser({ max: 60, windowMs: 10 * 60_000 }),
        validate('json', translationCheckRequestSchema),
        async (c) => {
          const userId = c.get('user').id;
          const input = c.req.valid('json');
          const { model, provider, modelId, disableReasoning } = await openModel(
            deps,
            userId,
            defaultCredentialId(deps, userId, input.credentialId),
          );
          const prompt = buildTranslationCheckPrompt(input);
          const log = (values: Partial<typeof schema.aiGenerations.$inferInsert>) =>
            db
              .insert(schema.aiGenerations)
              .values({
                userId,
                kind: 'sentence_grade',
                source: 'api',
                provider,
                model: modelId,
                promptVersion: TRANSLATION_CHECK_PROMPT_VERSION,
                prompt,
                parsedOk: false,
                ...values,
              })
              .run();
          let text: string;
          try {
            const answer = await generateAnswer({
              model,
              prompt,
              maxOutputTokens: 1_500,
              disableReasoning,
            });
            text = answer.text;
            const parsed = parseTranslationCheck(text);
            log({
              rawOutput: text,
              parsedOk: parsed.ok,
              tokensIn: answer.tokensIn,
              tokensOut: answer.tokensOut,
            });
            if (!parsed.ok) throw new HTTPException(502, { message: parsed.error });
            return c.json(parsed.content);
          } catch (err) {
            if (err instanceof HTTPException) throw err;
            const message = describeAiError(err);
            log({ rawOutput: null, error: message });
            throw new HTTPException(502, { message });
          }
        },
      )
  );
};
