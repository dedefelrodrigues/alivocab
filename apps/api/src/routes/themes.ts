import { schema } from '@alivocab/db';
import {
  type ContentSource,
  createThemeSchema,
  saveWordsSchema,
  type ThemeDetailDto,
  themeUpdateSchema,
} from '@alivocab/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getOrCreateProfile } from '../lib/profile.ts';
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

export const themeRoutes = ({ db, auth }: AppDeps) => {
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

  return new Hono<AuthedEnv>()
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
        saveWords(db, {
          userId,
          themeId: theme.id,
          lang: theme.targetLang,
          nativeLang: theme.nativeLang,
          words: input.words,
          source,
          generationId: input.generationId,
        });
      }
      return c.json(themeSummary(db, userId, findOwnedTheme(db, userId, theme.id)), 201);
    })
    .get('/:id', (c) => {
      const user = c.get('user');
      const theme = findOwnedTheme(db, user.id, c.req.param('id'));
      const detail: ThemeDetailDto = {
        ...themeSummary(db, user.id, theme),
        words: themeWords(db, user.id, theme, user.role === 'admin'),
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
      return c.json({
        ...result,
        theme: themeSummary(db, userId, findOwnedTheme(db, userId, theme.id)),
      });
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
    });
};
