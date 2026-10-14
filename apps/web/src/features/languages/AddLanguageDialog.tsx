import { languageName } from '@alivocab/shared';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { LanguageSelect } from '@/components/language-select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useActiveLang, useAddLanguage, useLanguages } from '@/hooks/useLanguages';
import { errorMessage } from '@/lib/api';

/** Starts a new learning language, or brings back one that was removed. */
export function AddLanguageDialog({ onClose }: { onClose: () => void }) {
  const languages = useLanguages();
  const activeLang = useActiveLang();
  const active = languages.find((l) => l.lang === activeLang);
  const add = useAddLanguage();
  const [lang, setLang] = useState<string | undefined>();
  const [nativeLang, setNativeLang] = useState<string | undefined>(active?.nativeLang);
  const [switchToIt, setSwitchToIt] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const learning = languages.filter((l) => !l.archived).map((l) => l.lang);
  const removed = languages.find((l) => l.lang === lang && l.archived);

  const chooseLang = (code: string) => {
    setLang(code);
    setError(null);
    // A removed language keeps its own translation language; otherwise reuse the current one.
    const previous = languages.find((l) => l.lang === code)?.nativeLang ?? active?.nativeLang;
    setNativeLang(previous && previous !== code ? previous : undefined);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!lang) return setError('Choose the language you want to learn');
    if (!nativeLang) return setError('Choose the language for translations');
    add.mutate(
      { lang, nativeLang, switchToIt },
      {
        onSuccess: () => {
          toast.success(removed ? `${languageName(lang)} is back` : `Added ${languageName(lang)}`);
          onClose();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a language</DialogTitle>
          <DialogDescription>
            Each language has its own themes, reviews, daily limits and voice.
          </DialogDescription>
        </DialogHeader>
        <form id="add-language" onSubmit={submit} className="grid gap-4">
          <FormField
            id="add-lang"
            label="I want to learn"
            hint={
              removed
                ? `You learned ${languageName(removed.lang)} before: its themes and progress come back.`
                : undefined
            }
          >
            <LanguageSelect
              id="add-lang"
              value={lang}
              onChange={chooseLang}
              exclude={learning}
              placeholder="Choose a language"
            />
          </FormField>
          <FormField id="add-native" label="Translations in" error={error}>
            <LanguageSelect
              id="add-native"
              value={nativeLang}
              onChange={(v) => {
                setNativeLang(v);
                setError(null);
              }}
              exclude={lang ? [lang] : []}
              placeholder="Choose a language"
            />
          </FormField>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={switchToIt}
              onChange={(e) => setSwitchToIt(e.target.checked)}
              className="size-4 accent-primary"
            />
            Switch to it now
          </label>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-language" disabled={add.isPending}>
            {removed ? 'Bring it back' : 'Add language'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
