import { describeAiError, generateAnswer } from '@alivocab/ai';
import { schema } from '@alivocab/db';
import {
  type ContentSource,
  createThemeSchema,
  FILL_KINDS,
  type FillKind,
  type FillPromptDto,
  type FillResultDto,
  fillGenerateSchema,
  fillImportSchema,
  MATERIAL_KINDS,
  type MaterialKind,
  materialGenerateSchema,
  materialImportSchema,
  materialPromptSchema,
  roleplayStartSchema,
  roleplaySuggestSchema,
  saveWordsSchema,
  type ThemeDetailDto,
  themeListQuerySchema,
  themeUpdateSchema,
} from '@alivocab/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { openModel } from '../lib/ai-model.ts';
import {
  FILL_BATCH,
  FILL_GENERATION_KIND,
  FILL_PROMPT_VERSION,
  fillPrompt,
  saveFill,
  wordsNeeding,
} from '../lib/fill.ts';
import { requestLanguage } from '../lib/languages.ts';
import {
  listMaterials,
  MATERIAL_GENERATION_KIND,
  MATERIAL_PROMPT_VERSION,
  materialPrompt,
  materialWords,
  parseMaterial,
  saveMaterial,
} from '../lib/materials.ts';
import { getOrCreateProfile } from '../lib/profile.ts';
import { rateLimitPerUser } from '../lib/rate-limit.ts';
import { startRoleplay, suggestScenarios } from '../lib/roleplay.ts';
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

const fillParams = z.object({ id: z.string().min(1), kind: z.enum(FILL_KINDS) });
const materialParams = z.object({ id: z.string().min(1), kind: z.enum(MATERIAL_KINDS) });

export const themeRoutes = (deps: AppDeps) => {
  const { db, auth, pictures } = deps;

  /** Logs a listening-script or grammar-note generation. */
  const logMaterial = (
    kind: MaterialKind,
    values: {
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
    },
  ) =>
    db
      .insert(aiGenerations)
      .values({
        kind: MATERIAL_GENERATION_KIND[kind],
        promptVersion: MATERIAL_PROMPT_VERSION[kind],
        ...values,
      })
      .returning({ id: aiGenerations.id })
      .get().id;

  /** Logs a fill-in generation (API call or pasted answer). */
  const logFill = (
    kind: FillKind,
    values: {
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
    },
  ) =>
    db
      .insert(aiGenerations)
      .values({
        kind: FILL_GENERATION_KIND[kind],
        promptVersion: FILL_PROMPT_VERSION[kind],
        ...values,
      })
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
      // One learning language's themes (`lang`, default the active one).
      .get('/', validate('query', themeListQuerySchema), (c) => {
        const userId = c.get('user').id;
        return c.json(
          listThemes(db, userId, requestLanguage(db, userId, c.req.valid('query')).lang),
        );
      })
      .post('/', validate('json', createThemeSchema), (c) => {
        const userId = c.get('user').id;
        const input = c.req.valid('json');
        const language = requestLanguage(db, userId, { lang: input.lang });
        const source = sourceOf(userId, input.generationId);
        const theme = db
          .insert(themes)
          .values({
            userId,
            name: input.name,
            slug: uniqueSlug(db, userId, input.name),
            description: input.description || null,
            targetLang: language.lang,
            nativeLang: language.nativeLang,
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
      // AI fills in what theme words lack: example sentences or grammatical forms.
      .post('/:id/fill/:kind/prompt', validate('param', fillParams), (c) => {
        const { id, kind } = c.req.valid('param');
        const theme = findOwnedTheme(db, c.get('user').id, id);
        const targets = wordsNeeding(db, theme, kind).slice(0, FILL_BATCH[kind]);
        const dto: FillPromptDto = {
          prompt: targets.length ? fillPrompt(theme, kind, targets) : '',
          promptVersion: FILL_PROMPT_VERSION[kind],
          lemmas: targets.map((t) => t.lemma),
        };
        return c.json(dto);
      })
      .post(
        '/:id/fill/:kind/import',
        validate('param', fillParams),
        validate('json', fillImportSchema),
        (c) => {
          const userId = c.get('user').id;
          const { id, kind } = c.req.valid('param');
          const theme = findOwnedTheme(db, userId, id);
          const { raw, prompt } = c.req.valid('json');
          const result = saveFill(db, theme, kind, raw, null);
          logFill(kind, {
            userId,
            source: 'manual',
            prompt: prompt ?? '',
            rawOutput: raw,
            parsedOk: result.added > 0,
          });
          return c.json(result);
        },
      )
      .post(
        '/:id/fill/:kind/generate',
        rateLimitPerUser({ max: 20, windowMs: 10 * 60_000 }),
        validate('param', fillParams),
        validate('json', fillGenerateSchema),
        async (c) => {
          const userId = c.get('user').id;
          const { id, kind } = c.req.valid('param');
          const theme = findOwnedTheme(db, userId, id);
          const input = c.req.valid('json');
          const targets = wordsNeeding(db, theme, kind).slice(0, FILL_BATCH[kind]);
          if (!targets.length) {
            const none: FillResultDto = { added: 0, words: 0, remaining: 0, issues: [] };
            return c.json(none);
          }
          const { model, provider, modelId, disableReasoning } = await openModel(
            deps,
            userId,
            input.credentialId,
            input.model,
          );
          const prompt = fillPrompt(theme, kind, targets);
          let answer: Awaited<ReturnType<typeof generateAnswer>>;
          try {
            answer = await generateAnswer({
              model,
              prompt,
              maxOutputTokens: Math.min(8_000, 160 * targets.length + 600),
              disableReasoning,
              emptyHint: 'returned nothing. Try a non-reasoning model.',
            });
          } catch (err) {
            const message = describeAiError(err);
            logFill(kind, {
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
          const generationId = logFill(kind, {
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
          const result = saveFill(db, theme, kind, answer.text, generationId);
          db.update(aiGenerations)
            .set({ parsedOk: result.added > 0 })
            .where(eq(aiGenerations.id, generationId))
            .run();
          return c.json(result);
        },
      )
      // Listening scripts and grammar notes written by AI for the theme.
      .get('/:id/materials', (c) => {
        const userId = c.get('user').id;
        const theme = findOwnedTheme(db, userId, c.req.param('id'));
        return c.json(listMaterials(db, userId, theme.id));
      })
      .post(
        '/:id/materials/:kind/prompt',
        validate('param', materialParams),
        validate('json', materialPromptSchema),
        (c) => {
          const userId = c.get('user').id;
          const { id, kind } = c.req.valid('param');
          const theme = findOwnedTheme(db, userId, id);
          const { offered } = materialWords(db, userId, theme, kind);
          if (!offered.length)
            throw new HTTPException(400, { message: 'Add words to the theme first' });
          return c.json({
            prompt: materialPrompt(kind, theme, offered, c.req.valid('json').options),
            promptVersion: MATERIAL_PROMPT_VERSION[kind],
          });
        },
      )
      .post(
        '/:id/materials/:kind/import',
        validate('param', materialParams),
        validate('json', materialImportSchema),
        (c) => {
          const userId = c.get('user').id;
          const { id, kind } = c.req.valid('param');
          const theme = findOwnedTheme(db, userId, id);
          const input = c.req.valid('json');
          const parsed = parseMaterial(kind, input.raw);
          const generationId = logMaterial(kind, {
            userId,
            source: 'manual',
            prompt: input.prompt ?? '',
            rawOutput: input.raw,
            parsedOk: parsed.ok,
            error: parsed.ok ? undefined : parsed.error,
          });
          if (!parsed.ok) {
            throw new HTTPException(422, { message: `Could not read the answer: ${parsed.error}` });
          }
          return c.json(saveMaterial(db, userId, theme, kind, parsed.content, generationId));
        },
      )
      .post(
        '/:id/materials/:kind/generate',
        rateLimitPerUser({ max: 20, windowMs: 10 * 60_000 }),
        validate('param', materialParams),
        validate('json', materialGenerateSchema),
        async (c) => {
          const userId = c.get('user').id;
          const { id, kind } = c.req.valid('param');
          const theme = findOwnedTheme(db, userId, id);
          const input = c.req.valid('json');
          const { offered } = materialWords(db, userId, theme, kind);
          if (!offered.length)
            throw new HTTPException(400, { message: 'Add words to the theme first' });
          const prompt = materialPrompt(kind, theme, offered, input.options);
          const { model, provider, modelId, disableReasoning } = await openModel(
            deps,
            userId,
            input.credentialId,
            input.model,
          );
          let answer: Awaited<ReturnType<typeof generateAnswer>>;
          try {
            answer = await generateAnswer({
              model,
              prompt,
              maxOutputTokens: 6_000,
              disableReasoning,
              emptyHint: 'returned nothing. Try a non-reasoning model.',
            });
          } catch (err) {
            const message = describeAiError(err);
            logMaterial(kind, {
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
          const parsed = parseMaterial(kind, answer.text);
          const generationId = logMaterial(kind, {
            userId,
            source: 'api',
            prompt,
            rawOutput: answer.text,
            parsedOk: parsed.ok,
            provider,
            model: modelId,
            error: parsed.ok ? undefined : parsed.error,
            tokensIn: answer.tokensIn,
            tokensOut: answer.tokensOut,
          });
          if (!parsed.ok) {
            throw new HTTPException(502, {
              message: `The model’s answer could not be read (${parsed.error}). Try again or use another model.`,
            });
          }
          return c.json(saveMaterial(db, userId, theme, kind, parsed.content, generationId));
        },
      )
      // Role-play: AI-suggested scenarios, then a chat (continued under /api/roleplay/:id).
      .post(
        '/:id/roleplay/suggest',
        rateLimitPerUser({ max: 20, windowMs: 10 * 60_000 }),
        validate('json', roleplaySuggestSchema),
        async (c) => {
          const userId = c.get('user').id;
          const theme = findOwnedTheme(db, userId, c.req.param('id'));
          const scenarios = await suggestScenarios(
            deps,
            userId,
            theme,
            c.req.valid('json').credentialId,
          );
          return c.json({ scenarios });
        },
      )
      .post('/:id/roleplay', validate('json', roleplayStartSchema), (c) => {
        const userId = c.get('user').id;
        const theme = findOwnedTheme(db, userId, c.req.param('id'));
        return c.json(startRoleplay(deps, userId, theme, c.req.valid('json')));
      })
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
