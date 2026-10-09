import type { LessonMode, MeDto } from '@alivocab/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, unwrap } from './api.ts';
import { authClient } from './auth-client.ts';

/** Current user + profile, or `null` when signed out. */
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async (): Promise<MeDto | null> => {
    const res = await api.me.$get();
    if (res.status === 401) return null;
    return unwrap(res);
  },
  staleTime: 60_000,
});

export const credentialsQuery = queryOptions({
  queryKey: ['credentials'],
  queryFn: () => unwrap(api.credentials.$get()),
});

export const invitesQuery = queryOptions({
  queryKey: ['admin', 'invites'],
  queryFn: () => unwrap(api.admin.invites.$get()),
});

export const usersQuery = queryOptions({
  queryKey: ['admin', 'users'],
  queryFn: async () => {
    const { data, error } = await authClient.admin.listUsers({
      query: { limit: 200, sortBy: 'createdAt', sortDirection: 'desc' },
    });
    if (error) throw new Error(error.message ?? 'Could not load users');
    return data.users;
  },
});

export const themesQuery = queryOptions({
  queryKey: ['themes'],
  queryFn: () => unwrap(api.themes.$get()),
});

export const themeQuery = (id: string) =>
  queryOptions({
    queryKey: ['themes', id],
    queryFn: () => unwrap(api.themes[':id'].$get({ param: { id } })),
  });

const tzOffset = () => String(new Date().getTimezoneOffset());

export const reviewSummaryQuery = queryOptions({
  queryKey: ['review', 'summary'],
  queryFn: () => unwrap(api.review.summary.$get({ query: { tzOffset: tzOffset() } })),
  refetchInterval: 5 * 60_000,
});

/** A session's queue is fetched once; grading updates the server, not this snapshot. */
export const reviewQueueQuery = (themeId: string | undefined, session: number) =>
  queryOptions({
    queryKey: ['review', 'queue', themeId ?? 'all', session],
    queryFn: () =>
      unwrap(
        api.review.queue.$get({ query: { tzOffset: tzOffset(), ...(themeId ? { themeId } : {}) } }),
      ),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

/** A lesson is fetched once per session, like the review queue. */
export const lessonQuery = (themeId: string | undefined, mode: LessonMode, session: number) =>
  queryOptions({
    queryKey: ['lesson', themeId ?? 'all', mode, session],
    queryFn: () =>
      unwrap(
        api.lessons.$get({
          query: { tzOffset: tzOffset(), mode, ...(themeId ? { themeId } : {}) },
        }),
      ),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

export const statsQuery = (themeId: string | undefined, days: number) =>
  queryOptions({
    queryKey: ['stats', themeId ?? 'all', days],
    queryFn: () =>
      unwrap(
        api.stats.$get({
          query: { tzOffset: tzOffset(), days: String(days), ...(themeId ? { themeId } : {}) },
        }),
      ),
    placeholderData: (previous) => previous,
  });
