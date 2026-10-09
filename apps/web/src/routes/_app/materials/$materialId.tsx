import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { GrammarNoteView } from '@/features/materials/GrammarNoteView';
import { ListeningPlayer } from '@/features/materials/ListeningPlayer';
import { SpeakButton } from '@/features/themes/SpeakButton';
import { api, errorMessage, unwrap } from '@/lib/api';
import { materialQuery } from '@/lib/queries';

export const Route = createFileRoute('/_app/materials/$materialId')({
  component: MaterialPage,
});

function MaterialPage() {
  const { materialId } = Route.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: material, isPending, error } = useQuery(materialQuery(materialId));
  const [confirming, setConfirming] = useState(false);
  const seenSent = useRef(false);

  const seen = useMutation({
    mutationFn: () => unwrap(api.materials[':id'].seen.$post({ param: { id: materialId } })),
  });
  /** Listening to (or reading) the material counts once as seeing its words. */
  const sendSeen = seen.mutate;
  const markSeen = useCallback(() => {
    if (seenSent.current) return;
    seenSent.current = true;
    sendSeen();
  }, [sendSeen]);

  // Reading a grammar note counts once it has been open for a little while.
  useEffect(() => {
    if (material?.kind !== 'grammar') return;
    const t = setTimeout(markSeen, 10_000);
    return () => clearTimeout(t);
  }, [material?.kind, markSeen]);

  const remove = useMutation({
    mutationFn: () => unwrap(api.materials[':id'].$delete({ param: { id: materialId } })),
    onSuccess: () => {
      toast.success('Deleted');
      if (material?.themeId) {
        void queryClient.invalidateQueries({ queryKey: ['themes', material.themeId, 'materials'] });
        void navigate({ to: '/themes/$themeId', params: { themeId: material.themeId } });
      } else void navigate({ to: '/themes' });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (isPending) return <Skeleton className="h-96 w-full rounded-2xl" />;
  if (error || !material) {
    return <p className="text-incorrect">Could not load this: {errorMessage(error)}</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to the theme">
          {material.themeId ? (
            <Link to="/themes/$themeId" params={{ themeId: material.themeId }}>
              <ArrowLeft />
            </Link>
          ) : (
            <Link to="/themes">
              <ArrowLeft />
            </Link>
          )}
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {material.kind === 'listening' ? 'Listening' : 'Grammar'}
          </p>
          <h1
            className="text-2xl font-bold tracking-tight"
            lang={material.kind === 'listening' ? material.lang : undefined}
          >
            {material.title}
          </h1>
        </div>
        <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => setConfirming(true)}>
          <Trash2 />
        </Button>
      </div>

      {material.kind === 'listening' ? (
        <ListeningPlayer material={material} onListened={markSeen} />
      ) : (
        <GrammarNoteView material={material} />
      )}

      {material.words.length > 0 && (
        <section className="space-y-2" aria-labelledby="words-heading">
          <h2 id="words-heading" className="font-semibold">
            Theme words in here
          </h2>
          <ul className="flex flex-wrap gap-2">
            {material.words.map((w) => (
              <li
                key={w.lexemeId}
                className="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pr-3 pl-1 text-sm"
              >
                <SpeakButton text={w.lemma} lang={material.lang} />
                <span lang={material.lang} className="font-medium">
                  {w.lemma}
                </span>
                <span className="text-muted-foreground">
                  {w.translations.slice(0, 2).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{material.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Your words and their progress stay; only this{' '}
              {material.kind === 'listening' ? 'listening' : 'note'} is removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
