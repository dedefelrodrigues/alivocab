/**
 * Role-play chats: a scenario played with the AI partner, stored as a `lessons` row
 * (kind `roleplay`). Each turn streams; when it ends, the learner's message (with its
 * correction) and the reply are saved, and theme words used count as exposures.
 */
import { describeAiError, generateAnswer, streamConversation } from '@alivocab/ai';
import {
  buildRoleplaySystem,
  buildScenariosPrompt,
  parseRoleplayTurn,
  parseScenarios,
  ROLEPLAY_OPENER,
  ROLEPLAY_PROMPT_VERSION,
  SCENARIOS_PROMPT_VERSION,
} from '@alivocab/core';
import type { Db } from '@alivocab/db';
import { schema } from '@alivocab/db';
import {
  type RoleplayContent,
  type RoleplayDto,
  type RoleplayMessage,
  type Scenario,
  scenarioSchema,
} from '@alivocab/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { AppDeps } from '../types.ts';
import { defaultCredentialId, openModel } from './ai-model.ts';
import { lessonWords, materialWords, wordsInText } from './materials.ts';

const { aiCredentials, aiGenerations, exposures, lessonLexemes, lessons, themes, userLexemes } =
  schema;

type ThemeRow = typeof themes.$inferSelect;
type LessonRow = typeof lessons.$inferSelect;

/** Turns per chat (learner messages), to keep cost and context bounded. */
export const MAX_TURNS = 40;

function logGeneration(
  db: Db,
  values: Omit<typeof aiGenerations.$inferInsert, 'kind' | 'source'> & { promptVersion: string },
) {
  db.insert(aiGenerations)
    .values({ kind: 'roleplay', source: 'api', ...values })
    .run();
}

export async function suggestScenarios(
  deps: AppDeps,
  userId: string,
  theme: ThemeRow,
  credentialId?: string,
): Promise<Scenario[]> {
  const { offered } = materialWords(deps.db, userId, theme, 'listening');
  const prompt = buildScenariosPrompt({
    targetLang: theme.targetLang,
    nativeLang: theme.nativeLang,
    themeName: theme.name,
    words: offered,
  });
  const { model, provider, modelId, disableReasoning } = await openModel(
    deps,
    userId,
    defaultCredentialId(deps, userId, credentialId),
  );
  let text: string;
  try {
    text = (await generateAnswer({ model, prompt, maxOutputTokens: 1_200, disableReasoning })).text;
  } catch (err) {
    throw new HTTPException(502, { message: describeAiError(err) });
  }
  const scenarios = parseScenarios(text)
    .map((s) => scenarioSchema.safeParse(s))
    .flatMap((r) => (r.success ? [r.data] : []))
    .slice(0, 3);
  logGeneration(deps.db, {
    userId,
    provider,
    model: modelId,
    promptVersion: SCENARIOS_PROMPT_VERSION,
    prompt,
    rawOutput: text,
    parsedOk: scenarios.length > 0,
  });
  if (!scenarios.length) {
    throw new HTTPException(502, {
      message: 'The model’s suggestions could not be read. Try again.',
    });
  }
  return scenarios;
}

export function startRoleplay(
  deps: AppDeps,
  userId: string,
  theme: ThemeRow,
  input: { scenario: Scenario; level: RoleplayContent['level']; credentialId?: string },
): RoleplayDto {
  const content: RoleplayContent = {
    scenario: input.scenario,
    level: input.level,
    credentialId: defaultCredentialId(deps, userId, input.credentialId),
    messages: [],
    finishedAt: null,
  };
  const row = deps.db
    .insert(lessons)
    .values({ userId, themeId: theme.id, kind: 'roleplay', title: input.scenario.title, content })
    .returning()
    .get();
  return roleplayDto(deps.db, row);
}

export function findOwnedRoleplay(db: Db, userId: string, id: string): LessonRow {
  const row = db
    .select()
    .from(lessons)
    .where(and(eq(lessons.id, id), eq(lessons.userId, userId), eq(lessons.kind, 'roleplay')))
    .get();
  if (!row) throw new HTTPException(404, { message: 'Chat not found' });
  return row;
}

function themeOf(db: Db, row: LessonRow): ThemeRow {
  const theme = row.themeId
    ? db.select().from(themes).where(eq(themes.id, row.themeId)).get()
    : undefined;
  if (!theme) throw new HTTPException(410, { message: 'The theme of this chat was deleted' });
  return theme;
}

export function roleplayDto(db: Db, row: LessonRow): RoleplayDto {
  const theme = themeOf(db, row);
  return {
    id: row.id,
    themeId: row.themeId,
    lang: theme.targetLang,
    nativeLang: theme.nativeLang,
    createdAt: row.createdAt.toISOString(),
    content: row.content as RoleplayContent,
    words: lessonWords(db, row.id, theme.nativeLang).map(({ lexemeId, lemma, translations }) => ({
      lexemeId,
      lemma,
      translations,
    })),
  };
}

/** Earlier turns as the model sees them (its own answers in the tag format it should keep). */
function history(messages: RoleplayMessage[]) {
  return messages.map((m) =>
    m.role === 'user'
      ? { role: 'user' as const, content: m.text }
      : {
          role: 'assistant' as const,
          content: `<correction>OK</correction>\n<explanation></explanation>\n<reply>${m.text}</reply>\n<translation>${m.translation ?? ''}</translation>`,
        },
  );
}

/** Streams the partner's next turn; saves both messages once the answer is complete. */
export async function sendRoleplayMessage(
  deps: AppDeps,
  userId: string,
  row: LessonRow,
  text: string | undefined,
): Promise<Response> {
  const { db } = deps;
  const content = row.content as RoleplayContent;
  if (content.finishedAt) throw new HTTPException(400, { message: 'This chat has ended' });
  if (!text && content.messages.length) {
    throw new HTTPException(400, { message: 'Write a message' });
  }
  if (content.messages.filter((m) => m.role === 'user').length >= MAX_TURNS) {
    throw new HTTPException(400, {
      message: 'This chat is long enough. End it and start a new one.',
    });
  }
  const theme = themeOf(db, row);
  const { offered, all } = materialWords(db, userId, theme, 'listening');
  const instructions = buildRoleplaySystem({
    targetLang: theme.targetLang,
    nativeLang: theme.nativeLang,
    scenario: content.scenario,
    level: content.level,
    words: offered,
  });
  // The chat's key may have been deleted since; then use the current default.
  const saved = db
    .select({ id: aiCredentials.id })
    .from(aiCredentials)
    .where(and(eq(aiCredentials.id, content.credentialId), eq(aiCredentials.userId, userId)))
    .get();
  const credentialId = saved?.id ?? defaultCredentialId(deps, userId);
  const { model, provider, modelId, disableReasoning } = await openModel(
    deps,
    userId,
    credentialId,
  );

  let logged = false;
  return streamConversation({
    model,
    instructions,
    messages: [...history(content.messages), { role: 'user', content: text ?? ROLEPLAY_OPENER }],
    disableReasoning,
    onDone: (answer, usage) => {
      const turn = parseRoleplayTurn(answer);
      const log = (error?: string) => {
        logged = true;
        logGeneration(db, {
          userId,
          provider,
          model: modelId,
          promptVersion: ROLEPLAY_PROMPT_VERSION,
          prompt: text ?? ROLEPLAY_OPENER,
          rawOutput: answer,
          parsedOk: !error,
          error: error ?? null,
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
        });
      };
      if (!turn.reply) {
        const error = 'The partner’s answer had no reply in it. Send your message again.';
        log(error);
        throw new Error(error);
      }
      const fresh = db.select().from(lessons).where(eq(lessons.id, row.id)).get();
      if (!fresh) return;
      const current = fresh.content as RoleplayContent;
      const added: RoleplayMessage[] = [];
      if (text) {
        added.push({
          role: 'user',
          text,
          correction:
            turn.corrected && turn.corrected !== text
              ? { corrected: turn.corrected, explanation: turn.explanation }
              : null,
        });
      }
      added.push({ role: 'assistant', text: turn.reply, translation: turn.translation });
      const next: RoleplayContent = { ...current, messages: [...current.messages, ...added] };
      const used = wordsInText(theme, [text ?? '', turn.reply].join('\n'), all);
      const now = new Date();
      db.transaction((tx) => {
        tx.update(lessons).set({ content: next }).where(eq(lessons.id, row.id)).run();
        if (!used.length) return;
        tx.insert(lessonLexemes)
          .values(used.map((lexemeId) => ({ lessonId: row.id, lexemeId })))
          .onConflictDoNothing()
          .run();
        const own = tx
          .select({ id: userLexemes.lexemeId })
          .from(userLexemes)
          .where(and(eq(userLexemes.userId, userId), inArray(userLexemes.lexemeId, used)))
          .all()
          .map((r) => r.id);
        if (!own.length) return;
        tx.insert(exposures)
          .values(
            own.map((lexemeId) => ({
              userId,
              lexemeId,
              context: 'roleplay' as const,
              lessonId: row.id,
              at: now,
            })),
          )
          .run();
        tx.update(userLexemes)
          .set({ exposureCount: sql`${userLexemes.exposureCount} + 1`, lastSeenAt: now })
          .where(and(eq(userLexemes.userId, userId), inArray(userLexemes.lexemeId, own)))
          .run();
      });
      log();
    },
    onFail: (message) => {
      if (logged) return;
      logGeneration(db, {
        userId,
        provider,
        model: modelId,
        promptVersion: ROLEPLAY_PROMPT_VERSION,
        prompt: text ?? ROLEPLAY_OPENER,
        rawOutput: null,
        parsedOk: false,
        error: message,
      });
    },
  });
}

export function finishRoleplay(db: Db, row: LessonRow): RoleplayDto {
  const content = row.content as RoleplayContent;
  if (!content.finishedAt) {
    db.update(lessons)
      .set({ content: { ...content, finishedAt: new Date().toISOString() } })
      .where(eq(lessons.id, row.id))
      .run();
  }
  return roleplayDto(db, db.select().from(lessons).where(eq(lessons.id, row.id)).get() ?? row);
}
