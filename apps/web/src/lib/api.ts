import type { AppType } from '@alivocab/api';
import { hc } from 'hono/client';

/** Typed API client. Same origin: Vite proxies /api in dev, the API serves the SPA in prod. */
export const api = hc<AppType>('/').api;
