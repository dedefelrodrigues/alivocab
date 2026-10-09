/** Request/response contracts shared by apps/api (validation) and apps/web (forms). */
import { z } from 'zod';
import { getPalette } from './appearance/palettes.ts';
import { COLOR_MODES } from './appearance/tokens.ts';
import { AI_PROVIDERS, type AiProvider, TTS_PROVIDERS, type UserRole } from './enums.ts';
import { languageCodeSchema } from './languages.ts';

// ── Profile ─────────────────────────────────────────────────────────────────

export const AI_SOURCE_SETTING_RE = /^(manual|browser|api:[\w-]+)$/;

export const profileUpdateSchema = z
  .object({
    targetLang: languageCodeSchema,
    nativeLang: languageCodeSchema,
    defaultWordCount: z.number().int().min(5).max(100),
    defaultAiSource: z.string().regex(AI_SOURCE_SETTING_RE),
    ttsProvider: z.enum(TTS_PROVIDERS),
    ttsVoice: z.string().max(200).nullable(),
    dailyNewLimit: z.number().int().min(0).max(200),
    dailyReviewLimit: z.number().int().min(0).max(2000),
    colorPalette: z
      .string()
      .refine((v) => v === 'auto' || getPalette(v) !== undefined, 'Unknown palette'),
    colorMode: z.enum(COLOR_MODES),
    autoPictures: z.boolean(),
    advancedMode: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export type ProfileDto = {
  targetLang: string;
  nativeLang: string;
  defaultWordCount: number;
  defaultAiSource: string;
  ttsProvider: (typeof TTS_PROVIDERS)[number];
  ttsVoice: string | null;
  dailyNewLimit: number;
  dailyReviewLimit: number;
  colorPalette: string;
  colorMode: (typeof COLOR_MODES)[number];
  autoPictures: boolean;
  /** Records every request in the activity log and shows the Log page. */
  advancedMode: boolean;
};

export type MeDto = {
  user: { id: string; name: string; email: string; role: UserRole };
  profile: ProfileDto;
};

// ── AI credentials ──────────────────────────────────────────────────────────

export const AI_PROVIDER_INFO: Record<
  AiProvider,
  {
    label: string;
    keyUrl?: string;
    needsBaseUrl: boolean;
    keyOptional: boolean;
    hint: string;
    /** Used when the credential has no default model; absent = the user must choose one. */
    defaultModel?: string;
  }
> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    needsBaseUrl: false,
    keyOptional: false,
    hint: 'Best quality for Polish grammar. Paid API.',
    defaultModel: 'claude-sonnet-5-5',
  },
  openai: {
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    needsBaseUrl: false,
    keyOptional: false,
    hint: 'GPT models. Paid API.',
  },
  deepseek: {
    label: 'DeepSeek',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    needsBaseUrl: false,
    keyOptional: false,
    hint: 'Low-cost API.',
    defaultModel: 'deepseek-chat',
  },
  google: {
    label: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    needsBaseUrl: false,
    keyOptional: false,
    hint: 'Has a free tier: create a key in Google AI Studio.',
    defaultModel: 'gemini-2.5-flash',
  },
  openrouter: {
    label: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/settings/keys',
    needsBaseUrl: false,
    keyOptional: false,
    hint: 'One key for many models, including free ones (ids ending in ":free").',
  },
  openai_compat: {
    label: 'OpenAI-compatible endpoint',
    needsBaseUrl: true,
    keyOptional: true,
    hint: 'Any server speaking the OpenAI API (e.g. a self-hosted model). Base URL ends in /v1.',
  },
};

const baseUrlSchema = z
  .url({ protocol: /^https?$/, error: 'Must be an http(s) URL' })
  .max(500)
  .transform((u) => u.replace(/\/+$/, ''));

export const credentialCreateSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    label: z.string().trim().min(1).max(60),
    apiKey: z.string().trim().max(500).default(''),
    baseUrl: baseUrlSchema.optional(),
    defaultModel: z.string().trim().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    const info = AI_PROVIDER_INFO[v.provider];
    if (info.needsBaseUrl && !v.baseUrl) {
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'Base URL is required' });
    }
    if (!info.keyOptional && v.apiKey.length < 8) {
      ctx.addIssue({ code: 'custom', path: ['apiKey'], message: 'API key is required' });
    }
  });

export type CredentialCreate = z.input<typeof credentialCreateSchema>;

export const credentialUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    apiKey: z.string().trim().min(8).max(500),
    baseUrl: baseUrlSchema.nullable(),
    defaultModel: z.string().trim().max(200).nullable(),
  })
  .partial();

export type CredentialUpdate = z.infer<typeof credentialUpdateSchema>;

export type CredentialDto = {
  id: string;
  provider: AiProvider;
  label: string;
  baseUrl: string | null;
  defaultModel: string | null;
  keyLast4: string;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  createdAt: string;
};

export type CredentialTestResult = {
  ok: boolean;
  message: string;
  models: string[];
};

// ── Admin: invites ──────────────────────────────────────────────────────────

export const inviteCreateSchema = z.object({
  maxUses: z.number().int().min(1).max(100).default(1),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(14),
  note: z.string().trim().max(120).optional(),
});

export type InviteCreate = z.input<typeof inviteCreateSchema>;

export type InviteDto = {
  id: string;
  code: string;
  note: string | null;
  maxUses: number;
  uses: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
};

// ── Cloud text-to-speech ────────────────────────────────────────────────────

export type CloudTtsProvider = Exclude<(typeof TTS_PROVIDERS)[number], 'browser'>;

/** Models and voices per cloud TTS provider. Voices work for any language. */
export const CLOUD_TTS: Record<
  CloudTtsProvider,
  { label: string; model: string; voices: readonly string[]; defaultVoice: string; note: string }
> = {
  openai: {
    label: 'OpenAI',
    model: 'gpt-4o-mini-tts',
    voices: [
      'coral',
      'alloy',
      'ash',
      'ballad',
      'echo',
      'fable',
      'nova',
      'onyx',
      'sage',
      'shimmer',
      'verse',
    ],
    defaultVoice: 'coral',
    note: 'Natural voices; about $15 per million characters on your OpenAI account.',
  },
  google: {
    label: 'Google Gemini',
    model: 'gemini-2.5-flash-preview-tts',
    voices: [
      'Kore',
      'Puck',
      'Charon',
      'Zephyr',
      'Fenrir',
      'Leda',
      'Aoede',
      'Orus',
      'Callirrhoe',
      'Enceladus',
    ],
    defaultVoice: 'Kore',
    note: 'Uses your Gemini key; the free tier is rate-limited.',
  },
};

/** The voice a cloud provider uses: the learner's choice if it belongs to it, else the default. */
export function cloudVoice(provider: CloudTtsProvider, voice: string | null | undefined): string {
  const info = CLOUD_TTS[provider];
  return voice && info.voices.includes(voice) ? voice : info.defaultVoice;
}

export const ttsRequestSchema = z.object({
  text: z.string().trim().min(1).max(600),
  lang: languageCodeSchema,
  /** Defaults to the learner's voice; dialogues pass a second voice for the other speaker. */
  voice: z.string().trim().max(40).optional(),
});

export type TtsResultDto = { url: string };
