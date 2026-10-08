import type { createModel } from '@alivocab/ai';
import type { Db } from '@alivocab/db';
import type { Auth } from './auth.ts';
import type { SecretBox } from './lib/crypto.ts';

export type AppDeps = {
  db: Db;
  auth: Auth;
  secretBox: SecretBox;
  /** Allow AI base URLs on private networks (local models). */
  allowPrivateAiBaseUrls: boolean;
  /** Injected for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Injected for tests; defaults to the AI SDK provider factory. */
  modelFactory?: typeof createModel;
  /** Request logging (off in tests). */
  log?: boolean;
};

export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
export type AuthUser = AuthSession['user'];

export type AuthedEnv = { Variables: { user: AuthUser; session: AuthSession['session'] } };
