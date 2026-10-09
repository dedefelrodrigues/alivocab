import { type TtsResultDto, ttsRequestSchema } from '@alivocab/shared';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { rateLimitPerUser } from '../lib/rate-limit.ts';
import { readAudio, speakText } from '../lib/tts.ts';
import { validate } from '../lib/validate.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { AppDeps, AuthedEnv } from '../types.ts';

/** Cloud pronunciation: `POST /` returns a URL to cached audio for the text. */
export const ttsRoutes = (deps: AppDeps) =>
  new Hono<AuthedEnv>()
    .use(requireAuth(deps.auth))
    .post(
      '/',
      rateLimitPerUser({ max: 300, windowMs: 10 * 60_000 }),
      validate('json', ttsRequestSchema),
      async (c) => {
        const spoken = await speakText(deps, c.get('user').id, c.req.valid('json'));
        const dto: TtsResultDto = {
          url: `/api/tts/audio/${spoken.hash}`,
          provider: spoken.provider,
          fallback: spoken.fallback,
        };
        return c.json(dto);
      },
    )
    .get('/audio/:hash', async (c) => {
      const audio = await readAudio(deps, c.req.param('hash'));
      if (!audio) throw new HTTPException(404, { message: 'Not found' });
      return c.body(new Uint8Array(audio.data), 200, {
        'Content-Type': audio.mime,
        // Content-addressed: the same hash always means the same audio.
        'Cache-Control': 'private, max-age=31536000, immutable',
      });
    });
