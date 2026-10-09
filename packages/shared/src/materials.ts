/**
 * Materials: AI-written listening scripts and grammar notes for a theme (stored in `lessons`).
 * The schemas validate AI output before it is saved.
 */
import { z } from 'zod';
import { CEFR_LEVELS } from './vocab.ts';

export const MATERIAL_KINDS = ['listening', 'grammar'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

const line = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const listeningScriptSchema = z.object({
  title: line(120),
  speakers: z
    .array(z.object({ id: line(12), name: line(40) }))
    .min(1)
    .max(4),
  lines: z
    .array(z.object({ speaker: line(12), text: line(500), translation: optionalText(500) }))
    .min(2)
    .max(60),
  questions: z
    .array(
      z.object({
        question: line(300),
        options: z.array(line(200)).min(2).max(5),
        /** Index into `options`. */
        answer: z.number().int().min(0),
      }),
    )
    .max(8)
    .default([]),
});
export type ListeningScript = z.output<typeof listeningScriptSchema>;

export const grammarNoteSchema = z.object({
  title: line(120),
  summary: optionalText(600),
  sections: z
    .array(
      z.object({
        heading: line(120),
        explanation: line(2000),
        examples: z
          .array(z.object({ text: line(300), translation: optionalText(300) }))
          .max(8)
          .default([]),
        table: z
          .object({
            headers: z.array(z.string().trim().max(60)).min(1).max(8),
            rows: z
              .array(z.array(z.string().trim().max(80)).max(8))
              .min(1)
              .max(16),
          })
          .nullish()
          .transform((v) => v ?? null),
      }),
    )
    .min(1)
    .max(8),
  tips: z.array(line(300)).max(6).default([]),
});
export type GrammarNote = z.output<typeof grammarNoteSchema>;

export const listeningOptionsSchema = z.object({
  style: z.enum(['dialogue', 'story']).default('dialogue'),
  length: z.enum(['short', 'medium']).default('short'),
  level: z.enum(CEFR_LEVELS).nullable().default(null),
});
export const grammarOptionsSchema = z.object({
  /** Optional topic, e.g. "instrumental after z" or "verb aspect". */
  focus: z.string().trim().max(120).optional(),
  level: z.enum(CEFR_LEVELS).nullable().default(null),
});
export type ListeningOptions = z.output<typeof listeningOptionsSchema>;
export type GrammarOptions = z.output<typeof grammarOptionsSchema>;

/** Options for either kind (validated against the kind's schema on the server). */
const optionsField = z.record(z.string(), z.unknown()).default({});

export const materialPromptSchema = z.object({ options: optionsField });
export const materialImportSchema = z.object({
  options: optionsField,
  raw: z.string().min(1).max(200_000),
  prompt: z.string().max(100_000).optional(),
});
export const materialGenerateSchema = z.object({
  options: optionsField,
  credentialId: z.string().min(1),
  model: z.string().trim().min(1).max(200).optional(),
});

export type MaterialSummaryDto = {
  id: string;
  /** Role-play chats are listed with materials too. */
  kind: MaterialKind | 'roleplay';
  title: string;
  createdAt: string;
  wordCount: number;
};

export type MaterialWordDto = { lexemeId: string; lemma: string; translations: string[] };

export type MaterialDto = Omit<MaterialSummaryDto, 'kind'> & {
  themeId: string | null;
  lang: string;
  nativeLang: string;
  words: MaterialWordDto[];
} & ({ kind: 'listening'; content: ListeningScript } | { kind: 'grammar'; content: GrammarNote });
