import {
  CLOUD_TTS,
  cloudVoice,
  cloudVoices,
  languageName,
  TTS_PROVIDERS,
  type TtsProvider,
} from '@alivocab/shared';
import { useQuery } from '@tanstack/react-query';
import { Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdateProfile } from '@/hooks/useProfile';
import { speak, useVoices, VOICE_SAMPLES } from '@/hooks/useVoices';
import { credentialsQuery, meQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { SettingsCard } from './SettingsCard';

const DEFAULT_VOICE = '__default__';

const PROVIDER_LABELS: Record<TtsProvider, { title: string; detail: string }> = {
  browser: {
    title: 'Browser voices',
    detail: 'Free, works offline; quality depends on the browser and device.',
  },
  edge: { title: 'Microsoft Edge voices', detail: CLOUD_TTS.edge.note },
  openai: { title: 'OpenAI', detail: CLOUD_TTS.openai.note },
  google: { title: 'Google Gemini (default)', detail: CLOUD_TTS.google.note },
};

/** Gemini first: it's the default. */
const PROVIDER_ORDER: TtsProvider[] = ['google', 'edge', 'openai', 'browser'];

/** What is used when the chosen voices don't work (the server tries Edge, the app the browser). */
function fallbackText(provider: TtsProvider): string | null {
  if (provider === 'browser') return null;
  return provider === 'edge'
    ? 'If they don’t work, the browser’s voice is used.'
    : `If ${CLOUD_TTS[provider].label} doesn’t work (no key, rate limit, an error), a Microsoft Edge voice is used, then the browser’s.`;
}

export function VoiceSection() {
  const { data: me } = useQuery(meQuery);
  const lang = me?.profile.targetLang ?? 'pl';
  const { supported, voices } = useVoices(lang);
  const { data: credentials } = useQuery(credentialsQuery);
  const update = useUpdateProfile();
  if (!me) return null;
  const provider = me.profile.ttsProvider;
  const hasKey =
    provider === 'browser' ||
    !CLOUD_TTS[provider].needsKey ||
    !!credentials?.some((c) => c.provider === provider);

  const current = me.profile.ttsVoice ?? DEFAULT_VOICE;
  const sample = VOICE_SAMPLES[lang] ?? VOICE_SAMPLES.en ?? '';

  return (
    <SettingsCard
      id="voice"
      title="Voice"
      description={`Pronunciation for ${languageName(lang)}: flashcards, lessons and listening.`}
    >
      <fieldset className="m-0 grid gap-2 border-0 p-0 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">Voices from</legend>
        {PROVIDER_ORDER.filter((p) => TTS_PROVIDERS.includes(p)).map((p) => (
          <label
            key={p}
            className={cn(
              'flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
              p === provider ? 'border-primary bg-primary/5' : 'hover:bg-accent',
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <input
                type="radio"
                name="ttsProvider"
                checked={p === provider}
                onChange={() =>
                  update.mutate(
                    // Voice names belong to a provider, so switching starts from its default.
                    { ttsProvider: p, ttsVoice: null },
                    { onSuccess: () => toast.success('Voice settings saved') },
                  )
                }
                className="accent-primary"
              />
              {PROVIDER_LABELS[p].title}
            </span>
            <span className="text-xs text-muted-foreground">{PROVIDER_LABELS[p].detail}</span>
          </label>
        ))}
      </fieldset>
      {fallbackText(provider) && (
        <p className="-mt-2 text-xs text-muted-foreground">{fallbackText(provider)}</p>
      )}

      {provider !== 'browser' && cloudVoices(provider, lang).length === 0 ? (
        <Alert>
          <AlertDescription>
            {CLOUD_TTS[provider].label} has no {languageName(lang)} voice, so the browser’s voice is
            used.
          </AlertDescription>
        </Alert>
      ) : provider !== 'browser' ? (
        <>
          {!hasKey && (
            <Alert>
              <AlertDescription>
                Add your {CLOUD_TTS[provider].label} API key under{' '}
                <a href="#ai" className="underline">
                  AI providers
                </a>{' '}
                to use these voices. Until then Microsoft Edge voices are used.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <FormField
                id="cloudVoice"
                label="Voice"
                hint={
                  provider === 'edge'
                    ? 'Dialogues use a second voice for the other person.'
                    : 'Each voice speaks every language. Dialogues use a second voice for the other person.'
                }
              >
                <Select
                  value={cloudVoice(provider, me.profile.ttsVoice, lang) ?? undefined}
                  onValueChange={(v) =>
                    update.mutate(
                      { ttsVoice: v },
                      { onSuccess: () => toast.success('Voice saved') },
                    )
                  }
                >
                  <SelectTrigger id="cloudVoice" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cloudVoices(provider, lang).map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => speak(sample, lang, me.profile.ttsVoice)}
            >
              <Volume2 /> Test voice
            </Button>
          </div>
        </>
      ) : !supported ? (
        <Alert>
          <AlertDescription>This browser does not support speech synthesis.</AlertDescription>
        </Alert>
      ) : voices.length === 0 ? (
        <Alert>
          <AlertDescription>
            No {languageName(lang)} voice is installed on this device. On macOS/iOS add one in
            Settings → Accessibility → Spoken Content → Voices; on Android in Text-to-speech
            settings.
          </AlertDescription>
        </Alert>
      ) : null}

      {provider === 'browser' && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <FormField
              id="ttsVoice"
              label="Voice"
              hint="Voices differ per device; the choice falls back to the default where it is missing."
            >
              <Select
                value={voices.some((v) => v.voiceURI === current) ? current : DEFAULT_VOICE}
                onValueChange={(v) =>
                  update.mutate(
                    { ttsVoice: v === DEFAULT_VOICE ? null : v },
                    { onSuccess: () => toast.success('Voice saved') },
                  )
                }
                disabled={!supported}
              >
                <SelectTrigger id="ttsVoice" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_VOICE}>
                    Device default for {languageName(lang)}
                  </SelectItem>
                  {voices.map((v) => (
                    <SelectItem key={v.voiceURI} value={v.voiceURI}>
                      {v.name}
                      <span className="text-muted-foreground">
                        {' '}
                        · {v.lang}
                        {v.localService ? '' : ' · online'}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!supported}
            onClick={() => speak(sample, lang, me.profile.ttsVoice)}
          >
            <Volume2 /> Test voice
          </Button>
        </div>
      )}
    </SettingsCard>
  );
}
