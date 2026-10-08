import { adminClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
  plugins: [adminClient()],
});

/** Header carrying the invite code on sign-up (see apps/api/src/auth.ts). */
export const INVITE_HEADER = 'x-invite-code';
