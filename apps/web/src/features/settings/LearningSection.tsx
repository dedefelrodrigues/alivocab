import { LANGUAGES, type ProfileDto } from '@alivocab/shared';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdateProfile } from '@/hooks/useProfile';
import { credentialsQuery, meQuery } from '@/lib/queries';
import { SettingsCard } from './SettingsCard';

type LearningFields = Pick<
  ProfileDto,
  | 'targetLang'
  | 'nativeLang'
  | 'defaultWordCount'
  | 'dailyNewLimit'
  | 'dailyReviewLimit'
  | 'defaultAiSource'
  | 'autoPictures'
>;

function pick(p: ProfileDto): LearningFields {
  return {
    targetLang: p.targetLang,
    nativeLang: p.nativeLang,
    defaultWordCount: p.defaultWordCount,
    dailyNewLimit: p.dailyNewLimit,
    dailyReviewLimit: p.dailyReviewLimit,
    defaultAiSource: p.defaultAiSource,
    autoPictures: p.autoPictures,
  };
}

export function LearningSection() {
  const { data: me } = useQuery(meQuery);
  const { data: credentials = [] } = useQuery(credentialsQuery);
  const update = useUpdateProfile();
  const [form, setForm] = useState<LearningFields | null>(null);

  useEffect(() => {
    if (me && !form) setForm(pick(me.profile));
  }, [me, form]);

  if (!me || !form) return null;

  const set = <K extends keyof LearningFields>(key: K, value: LearningFields[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const sameLanguage = form.targetLang === form.nativeLang;
  const dirty = JSON.stringify(form) !== JSON.stringify(pick(me.profile));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (sameLanguage) return;
    update.mutate(form, { onSuccess: () => toast.success('Learning settings saved') });
  };

  const numberField = (key: 'defaultWordCount' | 'dailyNewLimit' | 'dailyReviewLimit') => ({
    type: 'number' as const,
    inputMode: 'numeric' as const,
    value: String(form[key]),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(key, Number(e.target.value)),
  });

  return (
    <SettingsCard
      id="learning"
      title="Learning"
      description="What you are learning and how much at a time."
    >
      <form onSubmit={onSubmit} className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="targetLang" label="I am learning">
            <LanguageSelect
              id="targetLang"
              value={form.targetLang}
              onChange={(v) => set('targetLang', v)}
            />
          </FormField>
          <FormField
            id="nativeLang"
            label="Translate into"
            error={sameLanguage ? 'Pick a different language than the one you are learning' : null}
          >
            <LanguageSelect
              id="nativeLang"
              value={form.nativeLang}
              onChange={(v) => set('nativeLang', v)}
            />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField id="defaultWordCount" label="Words per theme" hint="5 – 100 (default 30)">
            <Input id="defaultWordCount" min={5} max={100} {...numberField('defaultWordCount')} />
          </FormField>
          <FormField id="dailyNewLimit" label="New words per day" hint="0 – 200">
            <Input id="dailyNewLimit" min={0} max={200} {...numberField('dailyNewLimit')} />
          </FormField>
          <FormField id="dailyReviewLimit" label="Reviews per day" hint="0 – 2000">
            <Input id="dailyReviewLimit" min={0} max={2000} {...numberField('dailyReviewLimit')} />
          </FormField>
        </div>

        <FormField
          id="defaultAiSource"
          label="Default word generator"
          hint="Used when you create a theme. You can switch it each time."
        >
          <Select value={form.defaultAiSource} onValueChange={(v) => set('defaultAiSource', v)}>
            <SelectTrigger id="defaultAiSource" className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Free</SelectLabel>
                <SelectItem value="manual">Copy prompt → paste result (any AI chat)</SelectItem>
                <SelectItem value="browser">In-browser model (experimental)</SelectItem>
              </SelectGroup>
              {credentials.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Your API keys</SelectLabel>
                  {credentials.map((c) => (
                    <SelectItem key={c.id} value={`api:${c.id}`}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </FormField>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={form.autoPictures}
            onChange={(e) => set('autoPictures', e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            <span className="font-medium">Add pictures automatically</span>
            <span className="block text-muted-foreground">
              New words that can be pictured get a free photo (Wikimedia Commons, Openverse,
              Pexels). You can change or hide any of them later.
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={!dirty}
            onClick={() => setForm(pick(me.profile))}
          >
            Reset
          </Button>
          <Button type="submit" disabled={!dirty || sameLanguage || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}

function LanguageSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LANGUAGES.map((l) => (
          <SelectItem key={l.code} value={l.code}>
            {l.name}
            {l.nativeName !== l.name && (
              <span className="text-muted-foreground"> · {l.nativeName}</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
