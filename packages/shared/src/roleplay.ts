/** Role-play chats: a scenario from the theme, played with the AI, with corrections. */
import { z } from 'zod';
import { CEFR_LEVELS, type CefrLevel } from './vocab.ts';

export const scenarioSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(400),
  /** Who the learner plays, e.g. "a customer". */
  userRole: z.string().trim().min(1).max(80),
  /** Who the AI plays, e.g. "the baker". */
  aiRole: z.string().trim().min(1).max(80),
});
export type Scenario = z.output<typeof scenarioSchema>;

export const scenarioListSchema = z.object({ scenarios: z.array(scenarioSchema).min(1).max(5) });

export const roleplaySuggestSchema = z.object({ credentialId: z.string().min(1).optional() });

export const roleplayStartSchema = z.object({
  scenario: scenarioSchema,
  level: z.enum(CEFR_LEVELS).nullable().default(null),
  credentialId: z.string().min(1).optional(),
});

/** No text = ask the AI to open the conversation (only before the first message). */
export const roleplayMessageSchema = z.object({
  text: z.string().trim().min(1).max(1000).optional(),
});

export type RoleplayCorrection = {
  /** The learner's message corrected; null when it was already right. */
  corrected: string | null;
  /** Short explanation in the native language. */
  explanation: string | null;
};

export type RoleplayMessage =
  | { role: 'user'; text: string; correction: RoleplayCorrection | null }
  | { role: 'assistant'; text: string; translation: string | null };

export type RoleplayContent = {
  scenario: Scenario;
  level: CefrLevel | null;
  /** The API key used for this chat. */
  credentialId: string;
  messages: RoleplayMessage[];
  finishedAt: string | null;
};

export type RoleplayDto = {
  id: string;
  themeId: string | null;
  lang: string;
  nativeLang: string;
  createdAt: string;
  content: RoleplayContent;
  /** Theme words used in the chat so far. */
  words: Array<{ lexemeId: string; lemma: string; translations: string[] }>;
};
