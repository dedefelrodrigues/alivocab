import {
  GENDER_LABELS,
  GENDERS,
  type Gender,
  type ThemeWordDto,
  type WordUpdate,
} from '@alivocab/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, errorMessage, unwrap } from '@/lib/api';
import { themeQuery } from '@/lib/queries';

const NONE = 'none';

/**
 * Personal fields (note, mnemonic) are always editable. Dictionary fields are shared between
 * learners, so they are only editable while nobody else uses the word (or by an admin).
 */
export function EditWordDialog({
  word,
  themeId,
  onClose,
}: {
  word: ThemeWordDto;
  themeId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [gender, setGender] = useState<Gender | null>(word.gender);
  const [translations, setTranslations] = useState(word.translations.join(', '));
  const [pronunciation, setPronunciation] = useState(word.pronunciation ?? '');
  const [note, setNote] = useState(word.note ?? '');
  const [mnemonic, setMnemonic] = useState(word.mnemonic ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (patch: WordUpdate) =>
      unwrap(api.words[':lexemeId'].$patch({ param: { lexemeId: word.lexemeId }, json: patch })),
    onSuccess: () => {
      toast.success('Word updated');
      void queryClient.invalidateQueries(themeQuery(themeId));
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const patch: WordUpdate = { note: note.trim() || null, mnemonic: mnemonic.trim() || null };
    if (word.editable) {
      const list = translations
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (!list.length) return setError('At least one translation is required');
      if (list.join('|') !== word.translations.join('|')) patch.translations = list;
      if (gender !== word.gender) patch.gender = gender;
      if ((pronunciation.trim() || null) !== word.pronunciation)
        patch.pronunciation = pronunciation.trim() || null;
    }
    save.mutate(patch);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit “{word.lemma}”</DialogTitle>
          {!word.editable && (
            <DialogDescription className="flex items-start gap-1.5">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              Other learners use this word, so its dictionary details are read-only. Your note and
              mnemonic are private.
            </DialogDescription>
          )}
        </DialogHeader>
        <form id="edit-word" onSubmit={submit} className="grid gap-4">
          {word.editable && (
            <>
              <FormField id="w-tr" label="Translations" hint="Separate with commas.">
                <Input
                  id="w-tr"
                  value={translations}
                  onChange={(e) => setTranslations(e.target.value)}
                />
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField id="w-gender" label="Gender">
                  <Select
                    value={gender ?? NONE}
                    onValueChange={(v) => setGender(v === NONE ? null : (v as Gender))}
                    disabled={word.pos !== 'noun'}
                  >
                    <SelectTrigger id="w-gender" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {GENDERS.map((g) => (
                        <SelectItem key={g} value={g}>
                          {g} · {GENDER_LABELS[g]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField id="w-ipa" label="Pronunciation (IPA)">
                  <Input
                    id="w-ipa"
                    value={pronunciation}
                    onChange={(e) => setPronunciation(e.target.value)}
                  />
                </FormField>
              </div>
            </>
          )}
          <FormField id="w-note" label="Note">
            <Input
              id="w-note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </FormField>
          <FormField id="w-mnemonic" label="Mnemonic" hint="A memory hook that works for you.">
            <Input
              id="w-mnemonic"
              value={mnemonic}
              maxLength={500}
              onChange={(e) => setMnemonic(e.target.value)}
            />
          </FormField>
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
          <Button type="submit" form="edit-word" disabled={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
