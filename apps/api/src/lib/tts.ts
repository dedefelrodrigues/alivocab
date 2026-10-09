/**
 * Cloud pronunciation: speaks text with the learner's chosen provider (Microsoft Edge voices
 * without a key, or OpenAI / Gemini with their own key) and caches the audio on disk by
 * content, so each sentence is generated (and paid for) once.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSpeechModel, describeAiError, synthesize, synthesizeEdge } from '@alivocab/ai';
import { normalizeText } from '@alivocab/core';
import { schema } from '@alivocab/db';
import { CLOUD_TTS, type CloudTtsProvider, cloudVoice, languageName } from '@alivocab/shared';
import { and, desc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { AppDeps } from '../types.ts';
import { decryptKey } from './credentials.ts';
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

/** Returns the cache hash of the spoken text (generating the audio if needed). */
export async function speakText(
  deps: AppDeps,
  userId: string,
  input: { text: string; lang: string; voice?: string },
): Promise<string> {
  const { db } = deps;
  const profile = getOrCreateProfile(db, userId);
  if (profile.ttsProvider === 'browser') {
    throw new HTTPException(400, {
      message: 'Pronunciation uses your browser’s voices. Choose a cloud voice in Settings.',
    });
  }
  const provider = profile.ttsProvider;
  const voice = cloudVoice(provider, input.voice ?? profile.ttsVoice, input.lang);
  if (!voice) {
    throw new HTTPException(400, {
      message: `${CLOUD_TTS[provider].label} has no ${languageName(input.lang)} voice.`,
    });
  }
  const hash = audioKey(provider, voice, input.lang, input.text);

  const cached = db.select().from(ttsCache).where(eq(ttsCache.hash, hash)).get();
  if (cached) return hash;
  const pending = inFlight.get(hash);
  if (pending) return pending;

  const credential =
    provider === 'edge'
      ? null
      : db
          .select()
          .from(aiCredentials)
          .where(and(eq(aiCredentials.userId, userId), eq(aiCredentials.provider, provider)))
          .orderBy(desc(aiCredentials.createdAt))
          .get();
  if (provider !== 'edge' && !credential) {
    throw new HTTPException(400, {
      message: `Add your ${CLOUD_TTS[provider].label} API key in Settings → AI providers to use its voices.`,
    });
  }

  const job = (async () => {
    const apiKey = credential ? decryptKey(deps.secretBox, credential, userId) : '';
    const text = normalizeText(input.text);
    let result: Awaited<ReturnType<typeof synthesize>>;
    try {
      if (deps.synthesizeFn) {
        result = await deps.synthesizeFn({ provider, apiKey, text, lang: input.lang, voice });
      } else if (provider === 'edge') {
        result = await synthesizeEdge({ text, voice });
      } else {
        result = await synthesize({
          provider,
          text,
          lang: input.lang,
          voice,
          model: createSpeechModel({ provider, apiKey, fetch: deps.fetchFn }),
        });
      }
    } catch (err) {
      throw new HTTPException(502, { message: describeAiError(err) });
    }
    const mime = result.mediaType.split(';')[0]?.trim() || 'audio/mpeg';
    const fileName = `${hash}.${EXTENSIONS[mime] ?? 'bin'}`;
    await mkdir(deps.audioDir, { recursive: true });
    await writeFile(join(deps.audioDir, fileName), result.audio);
    db.insert(ttsCache)
      .values({ hash, filePath: fileName, mime, bytes: result.audio.byteLength })
      .onConflictDoNothing()
      .run();
    return hash;
  })();
  inFlight.set(hash, job);
  try {
    return await job;
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
