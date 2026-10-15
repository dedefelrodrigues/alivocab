import { type LearningLanguageDto, languageName } from '@alivocab/shared';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { LanguageSelect } from '@/components/language-select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useUpdateLanguage } from '@/hooks/useLanguages';
import { errorMessage } from '@/lib/api';

/** Translation language and daily limits of one learning language. */
export function LanguageSettingsDialog({
  language,
  onClose,
}: {
  language: LearningLanguageDto;
  onClose: () => void;
}) {
  const update = useUpdateLanguage();
  const [nativeLang, setNativeLang] = useState(language.nativeLang);
  const [newLimit, setNewLimit] = useState(String(language.dailyNewLimit));
  const [reviewLimit, setReviewLimit] = useState(String(language.dailyReviewLimit));
  const [error, setError] = useState<string | null>(null);
  const name = languageName(language.lang);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const dailyNewLimit = Number(newLimit);
    const dailyReviewLimit = Number(reviewLimit);
    if (!Number.isInteger(dailyNewLimit) || dailyNewLimit < 0 || dailyNewLimit > 200)
      return setError('New words per day: 0 – 200');
    if (!Number.isInteger(dailyReviewLimit) || dailyReviewLimit < 0 || dailyReviewLimit > 2000)
      return setError('Reviews per day: 0 – 2000');
    update.mutate(
      { lang: language.lang, patch: { nativeLang, dailyNewLimit, dailyReviewLimit } },
      {
        onSuccess: () => {
          toast.success(`${name} settings saved`);
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
          <DialogTitle>{name}</DialogTitle>
        </DialogHeader>
        <form id="language-settings" onSubmit={submit} className="grid gap-4">
          <FormField
            id="lang-native"
            label="Translations in"
            hint={
              nativeLang !== language.nativeLang
                ? `Words you already have keep their ${languageName(language.nativeLang)} translations; switching back shows them again.`
                : undefined
            }
          >
            <LanguageSelect
              id="lang-native"
              value={nativeLang}
              onChange={setNativeLang}
              exclude={[language.lang]}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="lang-new" label="New words per day" hint="0 – 200">
              <Input
                id="lang-new"
                type="number"
                inputMode="numeric"
                min={0}
                max={200}
                value={newLimit}
                onChange={(e) => setNewLimit(e.target.value)}
              />
            </FormField>
            <FormField id="lang-reviews" label="Reviews per day" hint="0 – 2000">
              <Input
                id="lang-reviews"
                type="number"
                inputMode="numeric"
                min={0}
                max={2000}
                value={reviewLimit}
                onChange={(e) => setReviewLimit(e.target.value)}
              />
            </FormField>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="language-settings" disabled={update.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
