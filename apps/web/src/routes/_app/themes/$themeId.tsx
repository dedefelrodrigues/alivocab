import type { ThemeDetailDto, ThemeWordDto, WordStatus } from '@alivocab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Unlink,
} from 'lucide-react';
import { useMemo, useState } from 'react';
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
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { AddWordDialog } from '@/features/themes/AddWordDialog';
import { EditThemeDialog } from '@/features/themes/EditThemeDialog';
import { EditWordDialog } from '@/features/themes/EditWordDialog';
import { SpeakButton } from '@/features/themes/SpeakButton';
import { STATUS_META, StatusBar, StatusToggle } from '@/features/themes/status';
import { WordMeta } from '@/features/themes/WordMeta';
import { api, errorMessage, unwrap } from '@/lib/api';
import { themeQuery, themesQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/themes/$themeId')({
  component: ThemePage,
});

type Filter = WordStatus | 'all';
const FILTERS: Filter[] = ['all', 'unknown', 'recognize', 'known', 'untagged'];

function ThemePage() {
  const { themeId } = Route.useParams();
  const { data: theme, isPending, error } = useQuery(themeQuery(themeId));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingWord, setEditingWord] = useState<ThemeWordDto | null>(null);
  const [dialog, setDialog] = useState<'add' | 'edit' | 'delete' | null>(null);

  const setStatus = useMutation({
    mutationFn: ({ lexemeId, status }: { lexemeId: string; status: WordStatus }) =>
      unwrap(api.words[':lexemeId'].status.$patch({ param: { lexemeId }, json: { status } })),
    onMutate: async ({ lexemeId, status }) => {
      const key = themeQuery(themeId).queryKey;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ThemeDetailDto>(key);
      if (previous) {
        const words = previous.words.map((w) => (w.lexemeId === lexemeId ? { ...w, status } : w));
        const counts = { untagged: 0, unknown: 0, recognize: 0, known: 0 };
        for (const w of words) counts[w.status]++;
        queryClient.setQueryData<ThemeDetailDto>(key, { ...previous, words, counts });
      }
      return { previous };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(themeQuery(themeId).queryKey, ctx.previous);
      toast.error(errorMessage(err));
    },
    onSettled: () => void queryClient.invalidateQueries(themesQuery),
  });

  const unlink = useMutation({
    mutationFn: (lexemeId: string) =>
      unwrap(api.themes[':id'].words[':lexemeId'].$delete({ param: { id: themeId, lexemeId } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['themes'] });
      toast.success('Removed from theme (still in your dictionary)');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => unwrap(api.themes[':id'].$delete({ param: { id: themeId } })),
    onSuccess: async () => {
      queryClient.removeQueries(themeQuery(themeId));
      await queryClient.invalidateQueries(themesQuery);
      toast.success('Theme deleted');
      await navigate({ to: '/themes' });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const words = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return (theme?.words ?? []).filter(
      (w) =>
        (filter === 'all' || w.status === filter) &&
        (!q ||
          w.lemma.toLocaleLowerCase().includes(q) ||
          w.translations.some((t) => t.toLocaleLowerCase().includes(q))),
    );
  }, [theme, filter, search]);

  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (error || !theme) {
    return (
      <div className="space-y-3 text-center">
        <p>This theme doesn’t exist (or was deleted).</p>
        <Button asChild variant="outline">
          <Link to="/themes">All themes</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="All themes">
          <Link to="/themes">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">{theme.name}</h1>
          {theme.description && (
            <p className="text-sm text-muted-foreground">{theme.description}</p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Theme actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setDialog('edit')}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog('delete')} variant="destructive">
              <Trash2 /> Delete theme
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <StatusBar counts={theme.counts} />

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/themes/new" search={{ themeId: theme.id }}>
            <Sparkles /> Add more words
          </Link>
        </Button>
        <Button variant="outline" onClick={() => setDialog('add')}>
          <Plus /> Add a word
        </Button>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search words"
            placeholder="Search words or translations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <fieldset className="-mx-1 m-0 flex min-w-0 gap-1 overflow-x-auto border-0 px-1 pb-1">
          <legend className="sr-only">Filter by tag</legend>
          {FILTERS.map((f) => {
            const count = f === 'all' ? theme.wordCount : theme.counts[f];
            if (f !== 'all' && !count) return null;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1 text-sm transition-colors',
                  filter === f
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {f === 'all' ? 'All' : STATUS_META[f].label} · {count}
              </button>
            );
          })}
        </fieldset>

        {words.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {theme.wordCount ? 'No words match.' : 'No words yet. Add some above.'}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {words.map((w) => (
              <WordRow
                key={w.lexemeId}
                word={w}
                lang={theme.targetLang}
                expanded={expanded === w.lexemeId}
                onToggle={() => setExpanded(expanded === w.lexemeId ? null : w.lexemeId)}
                onStatus={(status) => setStatus.mutate({ lexemeId: w.lexemeId, status })}
                onEdit={() => setEditingWord(w)}
                onUnlink={() => unlink.mutate(w.lexemeId)}
              />
            ))}
          </ul>
        )}
      </div>

      {dialog === 'add' && <AddWordDialog themeId={theme.id} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && <EditThemeDialog theme={theme} onClose={() => setDialog(null)} />}
      {editingWord && (
        <EditWordDialog
          word={editingWord}
          themeId={theme.id}
          onClose={() => setEditingWord(null)}
        />
      )}
      <AlertDialog open={dialog === 'delete'} onOpenChange={(open) => !open && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{theme.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The theme is removed. Your words, tags and progress stay in your dictionary and in
              other themes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
              Delete theme
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function WordRow({
  word: w,
  lang,
  expanded,
  onToggle,
  onStatus,
  onEdit,
  onUnlink,
}: {
  word: ThemeWordDto;
  lang: string;
  expanded: boolean;
  onToggle: () => void;
  onStatus: (s: WordStatus) => void;
  onEdit: () => void;
  onUnlink: () => void;
}) {
  const detailsId = `word-${w.lexemeId}`;
  return (
    <li className="p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={detailsId}
          className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold" lang={lang}>
              {w.lemma}
            </span>
            <WordMeta pos={w.pos} gender={w.gender} aspect={w.aspect} />
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            {w.translations.join(', ')}
          </span>
        </button>
        <SpeakButton text={w.lemma} lang={lang} />
        <StatusToggle value={w.status} onChange={onStatus} size="sm" />
      </div>

      {expanded && (
        <div id={detailsId} className="mt-3 space-y-3 border-t pt-3 text-sm">
          {w.pronunciation && (
            <p>
              <span className="text-muted-foreground">Pronunciation:</span> /{w.pronunciation}/
            </p>
          )}
          {w.aspectPair && (
            <p>
              <span className="text-muted-foreground">Aspect pair:</span>{' '}
              <span lang={lang}>{w.aspectPair}</span>
            </p>
          )}
          {w.forms && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
              {Object.entries(w.forms).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k.replace(/_/g, ' ')}</dt>
                  <dd lang={lang}>{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {w.examples.map((ex) => (
            <div key={ex.id} className="flex items-start gap-1">
              <SpeakButton text={ex.text} lang={lang} />
              <p>
                <span lang={lang}>{ex.text}</span>
                {ex.translation && (
                  <span className="block text-muted-foreground">{ex.translation}</span>
                )}
              </p>
            </div>
          ))}
          {(w.note || w.mnemonic) && (
            <p className="rounded-md bg-muted/60 p-2">
              {w.note}
              {w.note && w.mnemonic && <br />}
              {w.mnemonic && <span>💡 {w.mnemonic}</span>}
            </p>
          )}
          {w.otherThemes.length > 0 && (
            <p className="text-muted-foreground">
              Also in:{' '}
              {w.otherThemes.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ', '}
                  <Link
                    to="/themes/$themeId"
                    params={{ themeId: t.id }}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {t.name}
                  </Link>
                </span>
              ))}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil /> Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={onUnlink}>
              <Unlink /> Remove from theme
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
