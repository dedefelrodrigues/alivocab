import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAppearance } from '@/appearance/AppearanceProvider';
import { AppHeader } from '@/components/app-header';
import { meQuery } from '@/lib/queries';
import { configureSpeech } from '@/lib/speech';

/** Pathless layout for everything that requires a signed-in user. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) throw redirect({ to: '/login', search: { redirect: location.href } });
    return { me };
  },
  component: AppLayout,
});

function AppLayout() {
  const { data: me } = useQuery(meQuery);
  const { hydrate } = useAppearance();
  const profile = me?.profile;

  // The account profile is the source of truth for appearance once signed in.
  useEffect(() => {
    if (profile) {
      hydrate({
        paletteSetting: profile.colorPalette,
        mode: profile.colorMode,
        targetLang: profile.targetLang,
      });
    }
  }, [profile, hydrate]);

  useEffect(() => {
    if (!me) return;
    configureSpeech({
      provider: me.profile.ttsProvider,
      voices: Object.fromEntries(me.languages.map((l) => [l.lang, l.ttsVoice])),
    });
  }, [me]);

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
