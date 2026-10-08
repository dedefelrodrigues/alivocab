import type { MeDto } from '@alivocab/shared';
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
