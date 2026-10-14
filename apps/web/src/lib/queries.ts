import type { LessonMode, LogCategory, MeDto } from '@alivocab/shared';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
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

/** One learning language's themes (PLAN.md D31). Invalidate all of them with `['themes']`. */
export const themesQuery = (lang: string) =>
  queryOptions({
    queryKey: ['themes', { lang }],
    queryFn: () => unwrap(api.themes.$get({ query: { lang } })),
  });

export const themeQuery = (id: string) =>
  queryOptions({
    queryKey: ['themes', id],
    queryFn: () => unwrap(api.themes[':id'].$get({ param: { id } })),
  });

const tzOffset = () => String(new Date().getTimezoneOffset());

/** A theme, or else every theme of one learning language (a theme brings its own language). */
const scope = (themeId: string | undefined, lang: string) => (themeId ? { themeId } : { lang });

export const reviewSummaryQuery = (lang: string) =>
  queryOptions({
    queryKey: ['review', 'summary', lang],
    queryFn: () => unwrap(api.review.summary.$get({ query: { tzOffset: tzOffset(), lang } })),
    refetchInterval: 5 * 60_000,
  });

/** A session's queue is fetched once; grading updates the server, not this snapshot. */
export const reviewQueueQuery = (themeId: string | undefined, lang: string, session: number) =>
  queryOptions({
    queryKey: ['review', 'queue', scope(themeId, lang), session],
    queryFn: () =>
      unwrap(api.review.queue.$get({ query: { tzOffset: tzOffset(), ...scope(themeId, lang) } })),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

/** A lesson is fetched once per session, like the review queue. */
export const lessonQuery = (
  themeId: string | undefined,
  lang: string,
  mode: LessonMode,
  session: number,
) =>
  queryOptions({
    queryKey: ['lesson', scope(themeId, lang), mode, session],
    queryFn: () =>
      unwrap(api.lessons.$get({ query: { tzOffset: tzOffset(), mode, ...scope(themeId, lang) } })),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

export const statsQuery = (themeId: string | undefined, lang: string, days: number) =>
  queryOptions({
    queryKey: ['stats', scope(themeId, lang), days],
    queryFn: () =>
      unwrap(
        api.stats.$get({
          query: { tzOffset: tzOffset(), days: String(days), ...scope(themeId, lang) },
        }),
      ),
    placeholderData: (previous) => previous,
  });

export const materialsQuery = (themeId: string) =>
  queryOptions({
    queryKey: ['themes', themeId, 'materials'],
    queryFn: () => unwrap(api.themes[':id'].materials.$get({ param: { id: themeId } })),
  });

export const materialQuery = (id: string) =>
  queryOptions({
    queryKey: ['materials', id],
    queryFn: () => unwrap(api.materials[':id'].$get({ param: { id } })),
    staleTime: Number.POSITIVE_INFINITY,
  });

export const roleplayQuery = (id: string) =>
  queryOptions({
    queryKey: ['roleplay', id],
    queryFn: () => unwrap(api.roleplay[':id'].$get({ param: { id } })),
  });

export const logsQuery = (filters: { level: 'all' | 'problems'; category?: LogCategory }) =>
  infiniteQueryOptions({
    queryKey: ['logs', filters],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.logs.$get({
          query: {
            level: filters.level,
            ...(filters.category ? { category: filters.category } : {}),
            ...(pageParam ? { before: String(pageParam) } : {}),
          },
        }),
      ),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore,
  });
