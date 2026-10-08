import { languageName } from '@alivocab/shared';
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
import { meQuery } from '@/lib/queries';
import { SettingsCard } from './SettingsCard';

const DEFAULT_VOICE = '__default__';

export function VoiceSection() {
  const { data: me } = useQuery(meQuery);
  const lang = me?.profile.targetLang ?? 'pl';
  const { supported, voices } = useVoices(lang);
  const update = useUpdateProfile();
  if (!me) return null;

  const current = me.profile.ttsVoice ?? DEFAULT_VOICE;
  const sample = VOICE_SAMPLES[lang] ?? VOICE_SAMPLES.en ?? '';

  return (
    <SettingsCard
      id="voice"
      title="Voice"
      description={`Pronunciation for ${languageName(lang)}. Uses your browser's built-in voices (free). Natural cloud voices come later.`}
    >
      {!supported ? (
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
    </SettingsCard>
  );
}
