import { describeAiError, generateAnswer } from '@alivocab/ai';
import { EXAMPLES_PROMPT_VERSION } from '@alivocab/core';
import { schema } from '@alivocab/db';
import {
  type ContentSource,
  createThemeSchema,
  type ExamplesPromptDto,
  type ExamplesResultDto,
  examplesGenerateSchema,
  examplesImportSchema,
  saveWordsSchema,
  type ThemeDetailDto,
  themeUpdateSchema,
} from '@alivocab/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { openModel } from '../lib/ai-model.ts';
import {
  EXAMPLES_BATCH,
  examplesPrompt,
  saveExamples,
  wordsNeedingExamples,
} from '../lib/examples.ts';
import { getOrCreateProfile } from '../lib/profile.ts';
import { rateLimitPerUser } from '../lib/rate-limit.ts';
import { validate } from '../lib/validate.ts';
import {
  findOwnedTheme,
  listThemes,
  saveWords,
  themeSummary,
  themeWords,
  uniqueSlug,
} from '../lib/vocab.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

const { themes, themeLexemes, aiGenerations } = schema;

export const themeRoutes = (deps: AppDeps) => {
  const { db, auth, pictures } = deps;

  /** Logs an example-sentence generation (API call or pasted answer). */
  const logExamples = (values: {
    userId: string;
    source: 'api' | 'manual';
    prompt: string;
    rawOutput: string | null;
    parsedOk: boolean;
    provider?: string;
    model?: string;
    error?: string;
    tokensIn?: number;
    tokensOut?: number;
  }) =>
    db
      .insert(aiGenerations)
      .values({ kind: 'example_sentences', promptVersion: EXAMPLES_PROMPT_VERSION, ...values })
      .returning({ id: aiGenerations.id })
      .get().id;

  /** Queues automatic pictures for saved words, if the user wants them. */
  const queuePictures = (userId: string, lexemeIds: string[]) => {
    if (getOrCreateProfile(db, userId).autoPictures) pictures.enqueue(lexemeIds);
  };

  /** Where saved words came from, for provenance on example sentences. */
  const sourceOf = (userId: string, generationId?: string): ContentSource => {
    if (!generationId) return 'user';
    const gen = db
      .select({ source: aiGenerations.source })
      .from(aiGenerations)
      .where(and(eq(aiGenerations.id, generationId), eq(aiGenerations.userId, userId)))
      .get();
    if (!gen) throw new HTTPException(400, { message: 'Unknown generation' });
    return gen.source === 'manual' ? 'import' : 'ai';
  };

  return (
    new Hono<AuthedEnv>()
      .use(requireAuth(auth))
      .get('/', (c) => c.json(listThemes(db, c.get('user').id)))
      .post('/', validate('json', createThemeSchema), (c) => {
        const userId = c.get('user').id;
        const input = c.req.valid('json');
        const profile = getOrCreateProfile(db, userId);
        const source = sourceOf(userId, input.generationId);
        const theme = db
          .insert(themes)
          .values({
            userId,
            name: input.name,
            slug: uniqueSlug(db, userId, input.name),
            description: input.description || null,
            targetLang: profile.targetLang,
            nativeLang: profile.nativeLang,
          })
          .returning()
          .get();
        if (input.words.length) {
          const saved = saveWords(db, {
            userId,
            themeId: theme.id,
            lang: theme.targetLang,
            nativeLang: theme.nativeLang,
            words: input.words,
            source,
            generationId: input.generationId,
          });
          queuePictures(userId, saved.lexemeIds);
        }
        return c.json(themeSummary(db, userId, findOwnedTheme(db, userId, theme.id)), 201);
      })
      .get('/:id', (c) => {
        const user = c.get('user');
        const theme = findOwnedTheme(db, user.id, c.req.param('id'));
        const words = themeWords(db, user.id, theme, user.role === 'admin', pictures.isPending);
        const detail: ThemeDetailDto = {
          ...themeSummary(db, user.id, theme),
          words,
          picturesPending: words.filter((w) => w.imagePending).length,
        };
        return c.json(detail);
      })
      .patch('/:id', validate('json', themeUpdateSchema), (c) => {
        const userId = c.get('user').id;
        const theme = findOwnedTheme(db, userId, c.req.param('id'));
        const patch = c.req.valid('json');
        db.update(themes)
          .set({
            ...patch,
            ...(patch.name ? { slug: uniqueSlug(db, userId, patch.name, theme.id) } : {}),
          })
          .where(eq(themes.id, theme.id))
          .run();
        return c.json(themeSummary(db, userId, findOwnedTheme(db, userId, theme.id)));
      })
      .delete('/:id', (c) => {
        const theme = findOwnedTheme(db, c.get('user').id, c.req.param('id'));
        // Links go with the theme; the user's words and progress stay in their dictionary.
        db.delete(themes).where(eq(themes.id, theme.id)).run();
        return c.body(null, 204);
      })
      .post('/:id/words', validate('json', saveWordsSchema), (c) => {
        const userId = c.get('user').id;
        const theme = findOwnedTheme(db, userId, c.req.param('id'));
        const input = c.req.valid('json');
        const result = saveWords(db, {
          userId,
          themeId: theme.id,
          lang: theme.targetLang,
          nativeLang: theme.nativeLang,
          words: input.words,
          source: sourceOf(userId, input.generationId),
          generationId: input.generationId,
        });
        queuePictures(userId, result.lexemeIds);
        const { lexemeIds: _ids, ...counts } = result;
        return c.json({
          ...counts,
          theme: themeSummary(db, userId, findOwnedTheme(db, userId, theme.id)),
        });
      })
      // Example sentences for words that have none (fill-in exercises need them).
      .post('/:id/examples/prompt', (c) => {
        const theme = findOwnedTheme(db, c.get('user').id, c.req.param('id'));
        const targets = wordsNeedingExamples(db, theme).slice(0, EXAMPLES_BATCH);
        const dto: ExamplesPromptDto = {
          prompt: targets.length ? examplesPrompt(theme, targets) : '',
          promptVersion: EXAMPLES_PROMPT_VERSION,
          lemmas: targets.map((t) => t.lemma),
        };
        return c.json(dto);
      })
      .post('/:id/examples/import', validate('json', examplesImportSchema), (c) => {
        const userId = c.get('user').id;
        const theme = findOwnedTheme(db, userId, c.req.param('id'));
        const { raw, prompt } = c.req.valid('json');
        const result = saveExamples(db, theme, raw, null);
        logExamples({
          userId,
          source: 'manual',
          prompt: prompt ?? '',
          rawOutput: raw,
          parsedOk: result.added > 0,
        });
        return c.json(result);
      })
      .post(
        '/:id/examples/generate',
        rateLimitPerUser({ max: 20, windowMs: 10 * 60_000 }),
        validate('json', examplesGenerateSchema),
        async (c) => {
          const userId = c.get('user').id;
          const theme = findOwnedTheme(db, userId, c.req.param('id'));
          const input = c.req.valid('json');
          const targets = wordsNeedingExamples(db, theme).slice(0, EXAMPLES_BATCH);
          if (!targets.length) {
            const none: ExamplesResultDto = { added: 0, words: 0, remaining: 0, issues: [] };
            return c.json(none);
          }
          const { model, provider, modelId, disableReasoning } = await openModel(
            deps,
            userId,
            input.credentialId,
            input.model,
          );
          const prompt = examplesPrompt(theme, targets);
          let answer: Awaited<ReturnType<typeof generateAnswer>>;
          try {
            answer = await generateAnswer({
              model,
              prompt,
              maxOutputTokens: Math.min(8_000, 160 * targets.length + 600),
              disableReasoning,
              emptyHint: 'returned no sentences. Try a non-reasoning model.',
            });
          } catch (err) {
            const message = describeAiError(err);
            logExamples({
              userId,
              source: 'api',
              prompt,
              rawOutput: null,
              parsedOk: false,
              provider,
              model: modelId,
              error: message,
            });
            throw new HTTPException(502, { message });
          }
          const generationId = logExamples({
            userId,
            source: 'api',
            prompt,
            rawOutput: answer.text,
            parsedOk: false,
            provider,
            model: modelId,
            tokensIn: answer.tokensIn,
            tokensOut: answer.tokensOut,
          });
          const result = saveExamples(db, theme, answer.text, generationId);
          db.update(aiGenerations)
            .set({ parsedOk: result.added > 0 })
            .where(eq(aiGenerations.id, generationId))
            .run();
          return c.json(result);
        },
      )
      // Retry pictures for every word in the theme that still has none.
      .post('/:id/pictures', (c) => {
        const theme = findOwnedTheme(db, c.get('user').id, c.req.param('id'));
        const ids = db
          .select({ id: themeLexemes.lexemeId })
          .from(themeLexemes)
          .where(eq(themeLexemes.themeId, theme.id))
          .all()
          .map((r) => r.id);
        return c.json({ queued: pictures.enqueue(ids, { force: true }) });
      })
      .delete('/:id/words/:lexemeId', (c) => {
        const theme = findOwnedTheme(db, c.get('user').id, c.req.param('id'));
        db.delete(themeLexemes)
          .where(
            and(
              eq(themeLexemes.themeId, theme.id),
              eq(themeLexemes.lexemeId, c.req.param('lexemeId')),
            ),
          )
          .run();
        return c.body(null, 204);
      })
  );
};
