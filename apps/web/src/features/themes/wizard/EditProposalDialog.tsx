import {
  GENDER_LABELS,
  GENDERS,
  type Gender,
  PARTS_OF_SPEECH,
  type PartOfSpeech,
  type VocabWord,
} from '@alivocab/shared';
import { type FormEvent, useState } from 'react';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
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

const NONE = 'none';

/** Fix a proposed word before saving (AI mistakes in gender, translation, example…). */
export function EditProposalDialog({
  word,
  onClose,
  onSave,
}: {
  word: VocabWord;
  onClose: () => void;
  onSave: (patch: Partial<VocabWord>) => void;
}) {
  const [lemma, setLemma] = useState(word.lemma);
  const [pos, setPos] = useState<PartOfSpeech>(word.pos);
  const [gender, setGender] = useState<Gender | null>(word.gender);
  const [translations, setTranslations] = useState(word.translations.join(', '));
  const [example, setExample] = useState(word.examples[0]?.text ?? '');
  const [exampleTranslation, setExampleTranslation] = useState(word.examples[0]?.translation ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const list = translations
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (!lemma.trim() || !list.length)
      return setError('Word and at least one translation are required');
    const first = word.examples[0];
    const examples = example.trim()
      ? [
          {
            text: example.trim(),
            translation: exampleTranslation.trim() || null,
            cloze: first && first.text === example.trim() ? first.cloze : null,
          },
          ...word.examples.slice(1),
        ]
      : word.examples.slice(1);
    onSave({
      lemma: lemma.trim(),
      pos,
      gender: pos === 'noun' ? gender : null,
      translations: list,
      examples,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit “{word.lemma}”</DialogTitle>
        </DialogHeader>
        <form id="edit-proposal" onSubmit={submit} className="grid gap-4">
          <FormField id="p-lemma" label="Word">
            <Input id="p-lemma" value={lemma} onChange={(e) => setLemma(e.target.value)} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField id="p-pos" label="Part of speech">
              <Select value={pos} onValueChange={(v) => setPos(v as PartOfSpeech)}>
                <SelectTrigger id="p-pos" className="w-full">
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
            <FormField id="p-gender" label="Gender">
              <Select
                value={gender ?? NONE}
                onValueChange={(v) => setGender(v === NONE ? null : (v as Gender))}
                disabled={pos !== 'noun'}
              >
                <SelectTrigger id="p-gender" className="w-full">
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
          <FormField id="p-translations" label="Translations" hint="Separate with commas.">
            <Input
              id="p-translations"
              value={translations}
              onChange={(e) => setTranslations(e.target.value)}
            />
          </FormField>
          <FormField id="p-example" label="Example sentence">
            <Input id="p-example" value={example} onChange={(e) => setExample(e.target.value)} />
          </FormField>
          <FormField id="p-example-tr" label="Example translation">
            <Input
              id="p-example-tr"
              value={exampleTranslation}
              onChange={(e) => setExampleTranslation(e.target.value)}
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
          <Button type="submit" form="edit-proposal">
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
