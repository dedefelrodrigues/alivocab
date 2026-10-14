import { type LearningLanguageDto, languageName } from '@alivocab/shared';
import { Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AddLanguageDialog } from '@/features/languages/AddLanguageDialog';
import { LanguageSettingsDialog } from '@/features/languages/LanguageSettingsDialog';
import {
  useActiveLang,
  useAddLanguage,
  useArchiveLanguage,
  useLanguages,
  useSwitchLanguage,
} from '@/hooks/useLanguages';
import { errorMessage } from '@/lib/api';
import { SettingsCard } from './SettingsCard';

/** The languages being learned (PLAN.md D31): switch, edit, add, remove and bring back. */
export function LanguagesSection() {
  const languages = useLanguages();
  const active = useActiveLang();
  const { switchTo } = useSwitchLanguage();
  const add = useAddLanguage();
  const [editing, setEditing] = useState<LearningLanguageDto | null>(null);
  const [adding, setAdding] = useState(false);
  const current = languages.filter((l) => !l.archived);
  const removed = languages.filter((l) => l.archived);

  const bringBack = (lang: string) =>
    add.mutate(
      { lang, switchToIt: false },
      {
        onSuccess: () => toast.success(`${languageName(lang)} is back`),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <SettingsCard
      id="languages"
      title="Languages"
      description="Each language has its own themes, reviews, daily limits and voice. Home, Review, Themes and Stats show the language you are learning now."
    >
      <ul className="divide-y rounded-lg border">
        {current.map((l) => (
          <LanguageRow
            key={l.lang}
            language={l}
            isActive={l.lang === active}
            onSwitch={() => switchTo(l.lang)}
            onEdit={() => setEditing(l)}
          />
        ))}
      </ul>
      <Button variant="outline" onClick={() => setAdding(true)}>
        <Plus /> Add a language
      </Button>

      {removed.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Removed</h3>
          <ul className="divide-y rounded-lg border">
            {removed.map((l) => (
              <li key={l.lang} className="flex items-center gap-3 p-3 text-sm">
                <span className="flex-1 text-muted-foreground">{languageName(l.lang)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => bringBack(l.lang)}
                  disabled={add.isPending}
                >
                  <Undo2 /> Bring back
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && <LanguageSettingsDialog language={editing} onClose={() => setEditing(null)} />}
      {adding && <AddLanguageDialog onClose={() => setAdding(false)} />}
    </SettingsCard>
  );
}

function LanguageRow({
  language,
  isActive,
  onSwitch,
  onEdit,
}: {
  language: LearningLanguageDto;
  isActive: boolean;
  onSwitch: () => void;
  onEdit: () => void;
}) {
  const archive = useArchiveLanguage();
  const name = languageName(language.lang);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-medium">
          {name}
          {isActive && <Badge variant="secondary">Learning now</Badge>}
        </p>
        <p className="text-sm text-muted-foreground">
          Translations in {languageName(language.nativeLang)} · {language.dailyNewLimit} new,{' '}
          {language.dailyReviewLimit} reviews a day
        </p>
      </div>
      <div className="flex gap-1">
        {!isActive && (
          <Button size="sm" variant="outline" onClick={onSwitch}>
            Switch
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${name}`} onClick={onEdit}>
          <Pencil />
        </Button>
        {!isActive && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`Remove ${name}`}>
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  It disappears from the language menu. Its themes, words and progress are kept, and
                  you can bring it back at any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => archive.mutate(language.lang)}>
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </li>
  );
}
