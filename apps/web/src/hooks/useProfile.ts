import type { MeDto, ProfileDto, ProfileUpdate } from '@alivocab/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAppearance } from '@/appearance/AppearanceProvider';
import { api, errorMessage, unwrap } from '@/lib/api';
import { meQuery } from '@/lib/queries';

/**
 * Saves profile fields with an optimistic update of the `me` cache. Appearance fields are
 * applied to the page immediately; on failure both are rolled back.
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const appearance = useAppearance();

  return useMutation({
    mutationFn: (patch: ProfileUpdate) => unwrap(api.me.profile.$patch({ json: patch })),
    onMutate: async (patch) => {
      await queryClient.cancelQueries(meQuery);
      const previous = queryClient.getQueryData<MeDto | null>(meQuery.queryKey);
      queryClient.setQueryData(meQuery.queryKey, (me) =>
        // Patch keys are a validated subset of the profile; omitted keys stay untouched.
        me ? { ...me, profile: { ...me.profile, ...patch } as ProfileDto } : me,
      );
      if (patch.colorPalette) appearance.setPaletteSetting(patch.colorPalette);
      if (patch.colorMode) appearance.setMode(patch.colorMode);
      return { previous };
    },
    onError: (err, _patch, ctx) => {
      const previous = ctx?.previous;
      if (previous) {
        queryClient.setQueryData(meQuery.queryKey, previous);
        appearance.hydrate({
          paletteSetting: previous.profile.colorPalette,
          mode: previous.profile.colorMode,
          targetLang: previous.profile.targetLang,
        });
      }
      toast.error(`Could not save: ${errorMessage(err)}`);
    },
    onSuccess: (profile) => {
      queryClient.setQueryData<MeDto | null>(meQuery.queryKey, (me) =>
        me ? { ...me, profile } : me,
      );
    },
  });
}
