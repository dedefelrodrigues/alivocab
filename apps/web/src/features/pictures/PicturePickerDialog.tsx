import type { PictureSearchResult } from '@alivocab/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Loader2, Search, Upload } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, errorMessage, unwrap } from '@/lib/api';
import { cn } from '@/lib/utils';

const MAX_UPLOAD = 8 * 1024 * 1024;

/** Search free photos (Openverse / Pexels), upload your own, or hide the picture. */
export function PicturePickerDialog({
  lexemeId,
  lemma,
  initialQuery,
  hasPicture,
  onClose,
}: {
  lexemeId: string;
  lemma: string;
  initialQuery: string;
  hasPicture: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<PictureSearchResult[] | null>(null);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const fileInput = useRef<HTMLInputElement>(null);

  const done = (message: string) => {
    toast.success(message);
    void queryClient.invalidateQueries({ queryKey: ['themes'] });
    void queryClient.invalidateQueries({ queryKey: ['review'] });
    onClose();
  };

  const search = useMutation({
    mutationFn: (q: string) => unwrap(api.pictures.search.$get({ query: { q } })),
    onSuccess: (r) => setResults(r.results),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const choose = useMutation({
    mutationFn: (hit: PictureSearchResult) =>
      unwrap(
        api.words[':lexemeId'].picture.$post({
          param: { lexemeId },
          json: { provider: hit.provider, id: hit.id },
        }),
      ),
    onSuccess: () => done('Picture updated'),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/words/${encodeURIComponent(lexemeId)}/picture/upload`, {
        method: 'POST',
        body,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Upload failed (${res.status})`);
      }
    },
    onSuccess: () => done('Picture uploaded'),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const hide = useMutation({
    mutationFn: () =>
      unwrap(
        api.words[':lexemeId'].picture.visibility.$put({
          param: { lexemeId },
          json: { hidden: true },
        }),
      ),
    onSuccess: () => done('Picture hidden for you'),
    onError: (err) => toast.error(errorMessage(err)),
  });

  // Search right away with the suggested phrase.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on open
  useEffect(() => {
    if (initialQuery.trim()) search.mutate(initialQuery.trim());
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) search.mutate(query.trim());
  };

  const busy = choose.isPending || upload.isPending;
  const usesPexels = results?.some((r) => r.provider === 'pexels');

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Picture for “{lemma}”</DialogTitle>
          <DialogDescription>
            Free photos with their licenses. Search in English for the best results.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex gap-2">
          <Input
            aria-label="Search photos"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. loaf of bread"
            autoFocus
          />
          <Button type="submit" disabled={search.isPending || !query.trim()}>
            {search.isPending ? <Loader2 className="animate-spin" /> : <Search />} Search
          </Button>
        </form>

        {search.isPending && (
          <p role="status" className="text-sm text-muted-foreground motion-safe:animate-pulse">
            Searching free photos… a new search can take about 10 seconds.
          </p>
        )}
        {results && results.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No photos found. Try a simpler or English phrase.
          </p>
        )}
        {results && results.length > 0 && (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Search results">
            {results
              .filter((hit) => !broken.has(`${hit.provider}-${hit.id}`))
              .map((hit) => (
                <li key={`${hit.provider}-${hit.id}`}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => choose.mutate(hit)}
                    className={cn(
                      'group relative block aspect-square w-full overflow-hidden rounded-md border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60',
                    )}
                    aria-label={`Use ${hit.title ?? 'this photo'}${hit.creator ? ` by ${hit.creator}` : ''}`}
                    title={[hit.title, hit.creator, hit.license].filter(Boolean).join(' · ')}
                  >
                    <img
                      src={hit.previewUrl}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={() => setBroken((b) => new Set(b).add(`${hit.provider}-${hit.id}`))}
                      className="size-full object-cover transition-transform group-hover:scale-105"
                    />
                    {choose.isPending && choose.variables?.id === hit.id && (
                      <span className="absolute inset-0 grid place-items-center bg-overlay/40">
                        <Loader2 className="size-6 animate-spin text-primary-foreground" />
                      </span>
                    )}
                  </button>
                </li>
              ))}
          </ul>
        )}
        {usesPexels && (
          <p className="text-xs text-muted-foreground">
            Photos provided by{' '}
            <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="underline">
              Pexels
            </a>{' '}
            and Openverse.
          </p>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (file.size > MAX_UPLOAD) return void toast.error('Pictures can be at most 8 MB');
              upload.mutate(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Upload your own
          </Button>
          {hasPicture && (
            <Button
              type="button"
              variant="ghost"
              disabled={hide.isPending}
              onClick={() => hide.mutate()}
            >
              <EyeOff /> No picture for this word
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
