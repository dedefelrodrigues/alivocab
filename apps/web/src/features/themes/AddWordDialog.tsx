import {
  GENDER_LABELS,
  GENDERS,
  type Gender,
  PARTS_OF_SPEECH,
  type PartOfSpeech,
  type WordStatus,
} from '@alivocab/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { StatusToggle } from './status';

const NONE = 'none';

/** Add a single word by hand. If it already exists in the dictionary, it is linked. */
export function AddWordDialog({ themeId, onClose }: { themeId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [lemma, setLemma] = useState('');
  const [pos, setPos] = useState<PartOfSpeech>('noun');
  const [gender, setGender] = useState<Gender | null>(null);
  const [translations, setTranslations] = useState('');
  const [example, setExample] = useState('');
  const [status, setStatus] = useState<WordStatus>('unknown');
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () => {
      const list = translations
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      return unwrap(
        api.themes[':id'].words.$post({
          param: { id: themeId },
          json: {
            words: [
              {
                lemma: lemma.trim(),
                pos,
                gender: pos === 'noun' ? gender : null,
                translations: list,
                examples: example.trim() ? [{ text: example.trim() }] : [],
                status,
              },
            ],
          },
        }),
      );
    },
    onSuccess: (r) => {
      toast.success(
        r.added ? `Added “${lemma.trim()}”` : `Linked “${lemma.trim()}” from your dictionary`,
      );
      void queryClient.invalidateQueries({ queryKey: ['themes'] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!lemma.trim() || !translations.trim()) return setError('Word and translation are required');
    add.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a word</DialogTitle>
          <DialogDescription>
            Use the dictionary form (e.g. infinitive for verbs).
          </DialogDescription>
        </DialogHeader>
        <form id="add-word" onSubmit={submit} className="grid gap-4">
          <FormField id="a-lemma" label="Word">
            <Input
              id="a-lemma"
              value={lemma}
              onChange={(e) => setLemma(e.target.value)}
              autoFocus
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField id="a-pos" label="Part of speech">
              <Select value={pos} onValueChange={(v) => setPos(v as PartOfSpeech)}>
                <SelectTrigger id="a-pos" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PARTS_OF_SPEECH.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField id="a-gender" label="Gender">
              <Select
                value={gender ?? NONE}
                onValueChange={(v) => setGender(v === NONE ? null : (v as Gender))}
                disabled={pos !== 'noun'}
              >
                <SelectTrigger id="a-gender" className="w-full">
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
          </div>
          <FormField id="a-tr" label="Translations" hint="Separate with commas.">
            <Input
              id="a-tr"
              value={translations}
              onChange={(e) => setTranslations(e.target.value)}
            />
          </FormField>
          <FormField id="a-ex" label="Example sentence (optional)">
            <Input id="a-ex" value={example} onChange={(e) => setExample(e.target.value)} />
          </FormField>
          <div className="grid gap-1.5">
            <span id="a-status" className="text-sm font-medium">
              How well do you know it?
            </span>
            <StatusToggle value={status} onChange={setStatus} labelledBy="a-status" />
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
          <Button type="submit" form="add-word" disabled={add.isPending}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
