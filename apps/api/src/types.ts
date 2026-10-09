import type { createModel, synthesize } from '@alivocab/ai';
import type { Db } from '@alivocab/db';
import type { CloudTtsProvider } from '@alivocab/shared';
import type { Auth } from './auth.ts';
import type { SecretBox } from './lib/crypto.ts';
import type { PictureService } from './lib/pictures/service.ts';

export type AppDeps = {
  db: Db;
  auth: Auth;
  secretBox: SecretBox;
  pictures: PictureService;
  /** Allow AI base URLs on private networks (local models). */
  allowPrivateAiBaseUrls: boolean;
  /** Injected for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Injected for tests; defaults to the AI SDK provider factory. */
  modelFactory?: typeof createModel;
  /** Where generated pronunciation audio is cached. */
  audioDir: string;
  /** Injected for tests; defaults to the provider's speech model. */
  synthesizeFn?: (input: {
    provider: CloudTtsProvider;
    apiKey: string;
    text: string;
    lang: string;
    voice: string;
  }) => ReturnType<typeof synthesize>;
  /** Request logging (off in tests). */
  log?: boolean;
};

export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
export type AuthUser = AuthSession['user'];

export type AuthedEnv = { Variables: { user: AuthUser; session: AuthSession['session'] } };
