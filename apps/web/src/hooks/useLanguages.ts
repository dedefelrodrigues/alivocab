import {
  DEFAULT_TARGET_LANG,
  type LanguageAdd,
  type LanguageUpdate,
  type LearningLanguageDto,
  type MeDto,
} from '@alivocab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage, unwrap } from '@/lib/api';
import { meQuery } from '@/lib/queries';
import { useUpdateProfile } from './useProfile';

/**
 * The active learning language (PLAN.md D31). Everything outside a theme (queue, themes, lessons,
 * stats) shows this language, and its query keys include it.
 */
export function useActiveLang(): string {
  const { data: me } = useQuery(meQuery);
  return me?.profile.targetLang ?? DEFAULT_TARGET_LANG;
}

/** The languages the learner has, in the order they were added (archived ones included). */
export function useLanguages(): LearningLanguageDto[] {
  const { data: me } = useQuery(meQuery);
  return me?.languages ?? [];
}

/** One learning language's settings (undefined while loading or when not learned). */
export function useLanguage(lang: string): LearningLanguageDto | undefined {
  return useLanguages().find((l) => l.lang === lang);
}

/** Puts a language's new settings into the cached `me` (and the profile, for the active one). */
function useStoreLanguage() {
  const queryClient = useQueryClient();
  return (language: LearningLanguageDto) =>
    queryClient.setQueryData<MeDto | null>(meQuery.queryKey, (me) => {
      if (!me) return me;
      const known = me.languages.some((l) => l.lang === language.lang);
      const { nativeLang, dailyNewLimit, dailyReviewLimit, ttsVoice } = language;
      return {
        ...me,
        languages: known
          ? me.languages.map((l) => (l.lang === language.lang ? language : l))
          : [...me.languages, language],
        profile:
          me.profile.targetLang === language.lang
            ? { ...me.profile, nativeLang, dailyNewLimit, dailyReviewLimit, ttsVoice }
            : me.profile,
      };
    });
}

/** Makes `lang` the active language (applied at once, saved to the account). */
export function useSwitchLanguage() {
  const update = useUpdateProfile();
  return {
    switchTo: (lang: string) => update.mutate({ targetLang: lang }),
    isPending: update.isPending,
  };
}

/** Starts learning a language (or brings back a removed one), optionally switching to it. */
export function useAddLanguage() {
  const store = useStoreLanguage();
  const { switchTo } = useSwitchLanguage();
  return useMutation({
    mutationFn: ({ switchToIt: _, ...input }: LanguageAdd & { switchToIt: boolean }) =>
      unwrap(api.languages.$post({ json: input })),
    onSuccess: (language, { switchToIt }) => {
      store(language);
      if (switchToIt) switchTo(language.lang);
    },
  });
}

/** Changes one language's translation language, daily limits or voice. */
export function useUpdateLanguage() {
  const queryClient = useQueryClient();
  const store = useStoreLanguage();
  return useMutation({
    mutationFn: ({ lang, patch }: { lang: string; patch: LanguageUpdate }) =>
      unwrap(api.languages[':lang'].$patch({ param: { lang }, json: patch })),
    onSuccess: (language, { patch }) => {
      store(language);
      // Limits change the queue; a translation language changes what every view shows.
      if (patch.dailyNewLimit !== undefined || patch.dailyReviewLimit !== undefined) {
        void queryClient.invalidateQueries({ queryKey: ['review'] });
      }
      if (patch.nativeLang) {
        for (const key of ['review', 'lesson', 'themes', 'stats']) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      }
    },
  });
}

/** Removes a language from the switcher; its themes, words and progress are kept. */
export function useArchiveLanguage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lang: string) => unwrap(api.languages[':lang'].$delete({ param: { lang } })),
    onSuccess: () => void queryClient.invalidateQueries(meQuery),
    onError: (err) => toast.error(errorMessage(err)),
  });
}
