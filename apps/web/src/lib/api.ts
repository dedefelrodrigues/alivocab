import type { AppType } from '@alivocab/api';
import { hc } from 'hono/client';

/** Typed API client. Same origin: Vite proxies /api in dev, the API serves the SPA in prod. */
export const api = hc<AppType>('/').api;

export type ApiIssue = { path: string; message: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: ApiIssue[] = [],
  ) {
    super(message);
  }
}

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };
/** Body types of every response in a union (distributive), minus error bodies. */
type SuccessBody<R> = R extends { json(): Promise<infer T> }
  ? Exclude<T, { error: unknown }>
  : never;

/** Awaits an RPC call, throws `ApiError` on non-2xx, returns the typed success body. */
export async function unwrap<R extends JsonResponse>(
  request: Promise<R> | R,
): Promise<SuccessBody<R>> {
  const res = await request;
  if (!res.ok) {
    let body: { error?: string; issues?: ApiIssue[] } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // Non-JSON error body.
    }
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body.issues);
  }
  if (res.status === 204) return undefined as never;
  return (await res.json()) as SuccessBody<R>;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.issues.length) {
    return err.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ');
  }
  return err instanceof Error ? err.message : String(err);
}
