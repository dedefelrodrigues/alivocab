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

export type TtsVoice = { id: string; label: string };

/**
 * Microsoft's neural voices behind Edge's "Read Aloud", per language (first = default). Unlike
 * the OpenAI and Gemini voices, each one speaks only its own language.
 */
export const EDGE_VOICES: Record<string, readonly TtsVoice[]> = {
  pl: [
    { id: 'pl-PL-ZofiaNeural', label: 'Zofia (female)' },
    { id: 'pl-PL-MarekNeural', label: 'Marek (male)' },
  ],
  en: [
    { id: 'en-US-AvaNeural', label: 'Ava (US, female)' },
    { id: 'en-US-AndrewNeural', label: 'Andrew (US, male)' },
    { id: 'en-GB-SoniaNeural', label: 'Sonia (UK, female)' },
    { id: 'en-GB-RyanNeural', label: 'Ryan (UK, male)' },
  ],
  pt: [
    { id: 'pt-BR-FranciscaNeural', label: 'Francisca (Brazil, female)' },
    { id: 'pt-BR-AntonioNeural', label: 'Antônio (Brazil, male)' },
    { id: 'pt-PT-RaquelNeural', label: 'Raquel (Portugal, female)' },
    { id: 'pt-PT-DuarteNeural', label: 'Duarte (Portugal, male)' },
  ],
  es: [
    { id: 'es-ES-ElviraNeural', label: 'Elvira (Spain, female)' },
    { id: 'es-ES-AlvaroNeural', label: 'Álvaro (Spain, male)' },
    { id: 'es-MX-DaliaNeural', label: 'Dalia (Mexico, female)' },
    { id: 'es-MX-JorgeNeural', label: 'Jorge (Mexico, male)' },
  ],
  fr: [
    { id: 'fr-FR-DeniseNeural', label: 'Denise (female)' },
    { id: 'fr-FR-HenriNeural', label: 'Henri (male)' },
  ],
  de: [
    { id: 'de-DE-KatjaNeural', label: 'Katja (female)' },
    { id: 'de-DE-ConradNeural', label: 'Conrad (male)' },
  ],
  it: [
    { id: 'it-IT-ElsaNeural', label: 'Elsa (female)' },
    { id: 'it-IT-DiegoNeural', label: 'Diego (male)' },
  ],
  uk: [
    { id: 'uk-UA-PolinaNeural', label: 'Polina (female)' },
    { id: 'uk-UA-OstapNeural', label: 'Ostap (male)' },
  ],
  nl: [
    { id: 'nl-NL-ColetteNeural', label: 'Colette (female)' },
    { id: 'nl-NL-MaartenNeural', label: 'Maarten (male)' },
  ],
  cs: [
    { id: 'cs-CZ-VlastaNeural', label: 'Vlasta (female)' },
    { id: 'cs-CZ-AntoninNeural', label: 'Antonín (male)' },
  ],
  sv: [
    { id: 'sv-SE-SofieNeural', label: 'Sofie (female)' },
    { id: 'sv-SE-MattiasNeural', label: 'Mattias (male)' },
  ],
  ro: [
    { id: 'ro-RO-AlinaNeural', label: 'Alina (female)' },
    { id: 'ro-RO-EmilNeural', label: 'Emil (male)' },
  ],
};

/** Models and voices per cloud TTS provider. */
export const CLOUD_TTS: Record<
  CloudTtsProvider,
  {
    label: string;
    model: string;
    /** Every voice, the default first (see `cloudVoices()` for the ones that suit a language). */
    voices: readonly string[];
    /** Needs the learner's API key for this provider. */
    needsKey: boolean;
    note: string;
  }
> = {
  edge: {
    label: 'Microsoft Edge',
    model: 'edge-read-aloud',
    voices: Object.values(EDGE_VOICES).flatMap((list) => list.map((v) => v.id)),
    needsKey: false,
    note: 'Free natural voices, no key needed. Unofficial: uses the service behind Edge’s Read Aloud.',
  },
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
    needsKey: true,
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
    needsKey: true,
    note: 'Uses your Gemini key; the free tier is rate-limited.',
  },
};

/** The voices a cloud provider has for a language (OpenAI and Gemini voices speak them all). */
export function cloudVoices(provider: CloudTtsProvider, lang: string): readonly TtsVoice[] {
  if (provider === 'edge') return EDGE_VOICES[lang] ?? [];
  return CLOUD_TTS[provider].voices.map((id) => ({ id, label: id }));
}

/**
 * The voice to use for `lang`: the learner's choice if the provider has it for that language,
 * else the provider's default for it. Null when the provider has no voice for the language.
 */
export function cloudVoice(
  provider: CloudTtsProvider,
  voice: string | null | undefined,
  lang: string,
): string | null {
  const voices = cloudVoices(provider, lang);
  if (voice && voices.some((v) => v.id === voice)) return voice;
  return voices[0]?.id ?? null;
}

export const ttsRequestSchema = z.object({
  text: z.string().trim().min(1).max(600),
  lang: languageCodeSchema,
  /** Defaults to the learner's voice; dialogues pass a second voice for the other speaker. */
  voice: z.string().trim().max(60).optional(),
});

export type TtsResultDto = {
  url: string;
  /** The provider that spoke (Edge when the learner's choice didn't work). */
  provider: CloudTtsProvider;
  fallback: { from: CloudTtsProvider; reason: string } | null;
};
