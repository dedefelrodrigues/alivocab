/**
 * Cloud pronunciation: speaks text with the learner's chosen provider (Gemini or OpenAI with
 * their own key, or Microsoft Edge voices without one), falling back to Edge when the choice
 * fails, and caches the audio on disk by content, so each sentence is generated (and paid
 * for) once. If nothing works, the web app falls back to the browser's voice.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSpeechModel, describeAiError, synthesize, synthesizeEdge } from '@alivocab/ai';
import { normalizeText } from '@alivocab/core';
import { schema } from '@alivocab/db';
import {
  CLOUD_TTS,
  type CloudTtsProvider,
  cloudVoice,
  cloudVoices,
  languageName,
} from '@alivocab/shared';
import { and, desc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { AppDeps } from '../types.ts';
import { recordLog } from './activity.ts';
import { decryptKey } from './credentials.ts';
import { getLanguage } from './languages.ts';
import { getOrCreateProfile } from './profile.ts';

const { aiCredentials, ttsCache } = schema;

export const AUDIO_HASH_RE = /^[a-f0-9]{64}$/;

const EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
};

/** Requests already being generated, so double clicks don't pay twice. */
const inFlight = new Map<string, Promise<string>>();

export function audioKey(provider: string, voice: string, lang: string, text: string): string {
  const model = CLOUD_TTS[provider as CloudTtsProvider]?.model ?? provider;
  return createHash('sha256')
    .update([provider, model, voice, lang, normalizeText(text)].join('\u0000'))
    .digest('hex');
}

/** After a provider fails for a learner, skip it for this long (rate limits, outages). */
export const PROVIDER_COOLDOWN_MS = 5 * 60_000;
/** A provider with a fallback after it gets this long before we move on. */
const FIRST_CHOICE_TIMEOUT_MS = 20_000;

/** `${userId}:${provider}` → time until which the provider is skipped. */
const cooldowns = new Map<string, number>();

/** The providers to try, in order: the learner's choice, then Edge (free, no key). */
export function ttsChain(provider: CloudTtsProvider): CloudTtsProvider[] {
  return provider === 'edge' ? ['edge'] : [provider, 'edge'];
}

export type SpokenAudio = {
  hash: string;
  provider: CloudTtsProvider;
  /** Set when an earlier provider in the chain didn't work. */
  fallback: { from: CloudTtsProvider; reason: string } | null;
};

/**
 * Speaks text with the first provider in the learner's chain that works (see `ttsChain()`),
 * reusing cached audio. Throws only when none works; the web app then uses the browser's voice.
 */
export async function speakText(
  deps: AppDeps,
  userId: string,
  input: { text: string; lang: string; voice?: string },
): Promise<SpokenAudio> {
  const { db } = deps;
  const profile = getOrCreateProfile(db, userId);
  if (profile.ttsProvider === 'browser') {
    throw new HTTPException(400, {
      message: 'Pronunciation uses your browser’s voices. Choose a cloud voice in Settings.',
    });
  }
  const chosen = profile.ttsProvider;
  // Each learning language has its own voice (empty: the provider's default for it).
  const learning = getLanguage(db, userId, input.lang);
  const ownVoice = learning ? learning.ttsVoice : profile.ttsVoice;
  const mainVoice = cloudVoice(chosen, ownVoice, input.lang);
  // A dialogue's second speaker asks for another voice; keep them apart after a fallback too.
  const secondSpeaker = !!input.voice && input.voice !== mainVoice;
  const chain = ttsChain(chosen);
  const failures: Array<{ provider: CloudTtsProvider; reason: string }> = [];
  // Whether any provider was actually called (else it's a setup problem, not an outage).
  let tried = false;

  for (const [i, provider] of chain.entries()) {
    const voices = cloudVoices(provider, input.lang);
    const voice =
      provider === chosen
        ? cloudVoice(provider, input.voice ?? ownVoice, input.lang)
        : (secondSpeaker ? (voices[1] ?? voices[0]) : voices[0])?.id;
    const fail = (reason: string) => failures.push({ provider, reason });
    if (!voice) {
      fail(`no ${languageName(input.lang)} voice.`);
      continue;
    }

    const hash = audioKey(provider, voice, input.lang, input.text);
    const done = (): SpokenAudio => {
      const first = failures[0];
      if (first) noteFallback(db, userId, input.text, failures, provider);
      return {
        hash,
        provider,
        fallback: first ? { from: first.provider, reason: first.reason } : null,
      };
    };
    if (db.select().from(ttsCache).where(eq(ttsCache.hash, hash)).get()) return done();

    const credential =
      provider !== 'edge'
        ? db
            .select()
            .from(aiCredentials)
            .where(and(eq(aiCredentials.userId, userId), eq(aiCredentials.provider, provider)))
            .orderBy(desc(aiCredentials.createdAt))
            .get()
        : null;
    if (provider !== 'edge' && !credential) {
      fail('needs your API key (Settings → AI providers).');
      continue;
    }
    const coolKey = `${userId}:${provider}`;
    if ((cooldowns.get(coolKey) ?? 0) > Date.now()) {
      fail('failed a moment ago, skipped for a few minutes.');
      continue;
    }

    tried = true;
    try {
      await generate(deps, hash, {
        provider,
        apiKey: credential ? decryptKey(deps.secretBox, credential, userId) : '',
        text: normalizeText(input.text),
        lang: input.lang,
        voice,
        timeoutMs: i < chain.length - 1 ? FIRST_CHOICE_TIMEOUT_MS : undefined,
      });
      cooldowns.delete(coolKey);
      return done();
    } catch (err) {
      cooldowns.set(coolKey, Date.now() + PROVIDER_COOLDOWN_MS);
      fail(describeAiError(err));
    }
  }

  const reasons = failures.map((f) => `${CLOUD_TTS[f.provider].label}: ${f.reason}`).join(' ');
  throw new HTTPException(tried ? 502 : 400, { message: reasons || 'No voice available.' });
}

/** Records in the activity log that the learner's first choice didn't work. */
function noteFallback(
  db: AppDeps['db'],
  userId: string,
  text: string,
  failures: Array<{ provider: CloudTtsProvider; reason: string }>,
  used: CloudTtsProvider,
) {
  const first = failures[0];
  if (!first) return;
  recordLog(db, {
    userId,
    level: 'warn',
    category: 'app',
    message: `Pronunciation: ${CLOUD_TTS[first.provider].label} didn’t work, used ${CLOUD_TTS[used].label}`,
    details: {
      context: 'pronunciation',
      text: text.slice(0, 80),
      failures: failures.map((f) => `${CLOUD_TTS[f.provider].label}: ${f.reason}`),
    },
  });
}

/** Generates and caches one clip (once, even if asked for twice at the same time). */
async function generate(
  deps: AppDeps,
  hash: string,
  request: {
    provider: CloudTtsProvider;
    apiKey: string;
    text: string;
    lang: string;
    voice: string;
    timeoutMs: number | undefined;
  },
): Promise<void> {
  const pending = inFlight.get(hash);
  if (pending) {
    await pending;
    return;
  }
  const job = (async () => {
    const { provider, apiKey, text, lang, voice, timeoutMs } = request;
    let result: Awaited<ReturnType<typeof synthesize>>;
    if (deps.synthesizeFn) {
      result = await deps.synthesizeFn({ provider, apiKey, text, lang, voice });
    } else if (provider === 'edge') {
      result = await synthesizeEdge({ text, voice });
    } else {
      result = await synthesize({
        provider,
        text,
        lang,
        voice,
        timeoutMs,
        model: createSpeechModel({ provider, apiKey, fetch: deps.fetchFn }),
      });
    }
    const mime = result.mediaType.split(';')[0]?.trim() || 'audio/mpeg';
    const fileName = `${hash}.${EXTENSIONS[mime] ?? 'bin'}`;
    await mkdir(deps.audioDir, { recursive: true });
    await writeFile(join(deps.audioDir, fileName), result.audio);
    deps.db
      .insert(ttsCache)
      .values({ hash, filePath: fileName, mime, bytes: result.audio.byteLength })
      .onConflictDoNothing()
      .run();
    return hash;
  })();
  inFlight.set(hash, job);
  try {
    await job;
  } finally {
    inFlight.delete(hash);
  }
}

/** Cached audio by hash, or null. */
export async function readAudio(deps: AppDeps, hash: string) {
  if (!AUDIO_HASH_RE.test(hash)) return null;
  const row = deps.db.select().from(ttsCache).where(eq(ttsCache.hash, hash)).get();
  if (!row) return null;
  try {
    return { data: await readFile(join(deps.audioDir, row.filePath)), mime: row.mime };
  } catch {
    return null;
  }
}
