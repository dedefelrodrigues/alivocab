import type { PictureSearchResult, SearchProvider } from '@alivocab/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardPaste, ExternalLink, EyeOff, Link2, Loader2, Search, Upload } from 'lucide-react';
import { type ClipboardEvent, type DragEvent, type FormEvent, useRef, useState } from 'react';
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

const PROVIDER_NAMES: Record<SearchProvider, string> = {
  wikimedia: 'Wikimedia Commons',
  openverse: 'Openverse',
  pexels: 'Pexels',
};

/** Image searches the learner can open in a new tab, to bring a picture back by pasting it. */
const ELSEWHERE: Array<{ name: string; url: (q: string) => string }> = [
  {
    name: 'Google Images',
    url: (q) => `https://www.google.com/search?udm=2&q=${encodeURIComponent(q)}`,
  },
  {
    name: 'Bing Images',
    url: (q) => `https://www.bing.com/images/search?q=${encodeURIComponent(q)}`,
  },
  {
    name: 'Unsplash',
    url: (q) =>
      `https://unsplash.com/s/photos/${encodeURIComponent(q.trim().replace(/\s+/g, '-'))}`,
  },
];

const canReadClipboard = () =>
  typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function';

const isWebLink = (text: string) => /^https?:\/\/\S+$/i.test(text.trim());
const isDataImage = (text: string) => /^data:image\/[\w.+-]+;base64,/i.test(text.trim());

/** A `data:image/…` address (Google Images thumbnails often copy as one) as a file. */
async function dataUrlToFile(dataUrl: string): Promise<File> {
  const blob = await (await fetch(dataUrl.trim())).blob();
  return new File([blob], 'pasted-image', { type: blob.type });
}

const providersQuery = {
  queryKey: ['pictures', 'providers'],
  queryFn: () => unwrap(api.pictures.providers.$get()),
  staleTime: Number.POSITIVE_INFINITY,
};

/** Search free photos (Wikimedia Commons, Openverse, Pexels), upload your own, or hide it. */
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
  /** The phrase last searched for; searching starts right away with the suggested one. */
  const [submitted, setSubmitted] = useState(initialQuery.trim());
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const [link, setLink] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const done = (message: string) => {
    toast.success(message);
    void queryClient.invalidateQueries({ queryKey: ['themes'] });
    void queryClient.invalidateQueries({ queryKey: ['review'] });
    onClose();
  };

  // One request per provider, so fast providers show their photos without waiting for slow ones.
  const { data: providerList } = useQuery(providersQuery);
  const providers = providerList?.providers ?? [];
  const searches = useQueries({
    queries: providers.map((provider) => ({
      queryKey: ['pictures', 'search', provider, submitted],
      queryFn: () =>
        unwrap(api.pictures.search.$get({ query: { q: submitted, provider } })).then(
          (r) => r.results,
        ),
      enabled: !!submitted,
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  const searching = searches.some((s) => s.isFetching);
  const results: PictureSearchResult[] = searches.flatMap((s) => s.data ?? []);
  const finished = !!submitted && providers.length > 0 && !searching;
  const slow = providers.filter((_, i) => searches[i]?.isFetching);
  const failed = providers.flatMap((provider, i) => {
    const error = searches[i]?.error;
    return error ? [{ provider, message: errorMessage(error) }] : [];
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

  const fromLink = useMutation({
    mutationFn: (url: string) =>
      unwrap(api.words[':lexemeId'].picture.link.$post({ param: { lexemeId }, json: { url } })),
    onSuccess: () => done('Picture added'),
    onError: (err) => toast.error(errorMessage(err)),
  });

  /** Uses whatever the learner brought: an image file, a data: image or a web address. */
  const bring = async (item: File | string) => {
    if (typeof item !== 'string') {
      if (!item.type.startsWith('image/')) return void toast.error('That is not a picture');
      if (item.size > MAX_UPLOAD) return void toast.error('Pictures can be at most 8 MB');
      return upload.mutate(item);
    }
    const text = item.trim();
    if (isDataImage(text)) return bring(await dataUrlToFile(text));
    if (isWebLink(text)) return fromLink.mutate(text);
    toast.error('Paste a picture, or a web address starting with https://');
  };

  const imageFile = (files: FileList | null | undefined) =>
    Array.from(files ?? []).find((f) => f.type.startsWith('image/'));

  /** Pasting anywhere in the dialog: an image on the clipboard is used right away. */
  const onPaste = (e: ClipboardEvent) => {
    const file = imageFile(e.clipboardData.files);
    if (file) {
      e.preventDefault();
      void bring(file);
    }
  };

  /** Pasting into the link field: a web address or data: image is used right away. */
  const onLinkPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (imageFile(e.clipboardData.files)) return; // handled by the dialog
    const text = e.clipboardData.getData('text/plain');
    if (isWebLink(text) || isDataImage(text)) {
      e.preventDefault();
      setLink(isDataImage(text) ? '' : text.trim());
      void bring(text);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = imageFile(e.dataTransfer.files);
    if (file) return void bring(file);
    const text =
      e.dataTransfer.getData('text/uri-list').split('\n')[0] ||
      e.dataTransfer.getData('text/plain');
    if (text) void bring(text);
  };

  /** The Paste button (handy on phones): reads an image, or else a link, from the clipboard. */
  const pasteFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) {
          const blob = await item.getType(type);
          return void bring(new File([blob], 'pasted-image', { type }));
        }
      }
      for (const item of items) {
        if (item.types.includes('text/plain')) {
          const text = await (await item.getType('text/plain')).text();
          if (isWebLink(text)) setLink(text.trim());
          return void bring(text);
        }
      }
      toast.error('Nothing to paste. Copy a picture or its address first.');
    } catch {
      toast.error('Could not read the clipboard. Paste into the field instead.');
    }
  };

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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (q === submitted) {
      // Same phrase again: retry only the providers that failed.
      searches.forEach((s) => {
        if (s.error) void s.refetch();
      });
    } else setSubmitted(q);
  };

  const busy = choose.isPending || upload.isPending || fromLink.isPending;
  const elsewhereQuery = query.trim() || submitted || lemma;
  const usesPexels = results.some((r) => r.provider === 'pexels');

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          'max-h-[90dvh] overflow-y-auto sm:max-w-2xl',
          dragging && 'ring-[3px] ring-ring/50',
        )}
        onPaste={onPaste}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
      >
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
          <Button type="submit" disabled={!query.trim()}>
            {searching ? <Loader2 className="animate-spin" /> : <Search />} Search
          </Button>
        </form>

        {slow.length > 0 && (
          <p role="status" className="text-sm text-muted-foreground motion-safe:animate-pulse">
            Searching {slow.map((p) => PROVIDER_NAMES[p]).join(' and ')}…
            {slow.includes('openverse') && results.length > 0 && ' (Openverse can be slow)'}
          </p>
        )}
        {failed.length > 0 && (
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {failed.map((f) => (
              <li key={f.provider}>
                {PROVIDER_NAMES[f.provider]}: {f.message}
              </li>
            ))}
          </ul>
        )}
        {finished && results.length === 0 && failed.length < providers.length && (
          <p className="text-sm text-muted-foreground">
            No photos found. Try a shorter English phrase, like “orange” or “bread roll”.
          </p>
        )}
        {results.length > 0 && (
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
            </a>
            , Wikimedia Commons and Openverse.
          </p>
        )}

        <section aria-labelledby="picture-elsewhere" className="space-y-3 border-t pt-4">
          <div>
            <h3 id="picture-elsewhere" className="text-sm font-medium">
              Find one elsewhere
            </h3>
            <p className="text-xs text-muted-foreground">
              Open a search, pick a picture, then copy it (right-click or long-press → Copy image,
              or Copy image address) and paste it below. You can also drag it here. Only you will
              see pictures you bring.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {ELSEWHERE.map((site) => (
              <Button key={site.name} asChild variant="outline" size="sm">
                <a href={site.url(elsewhereQuery)} target="_blank" rel="noreferrer">
                  {site.name} <ExternalLink />
                </a>
              </Button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim()) void bring(link);
            }}
          >
            <Input
              aria-label="Paste a picture or its web address"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onPaste={onLinkPaste}
              placeholder="Paste a picture or its address"
              inputMode="url"
              disabled={busy}
            />
            {canReadClipboard() && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void pasteFromClipboard()}
              >
                <ClipboardPaste /> Paste
              </Button>
            )}
            <Button type="submit" disabled={busy || !link.trim()}>
              {fromLink.isPending ? <Loader2 className="animate-spin" /> : <Link2 />} Use
            </Button>
          </form>
        </section>

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
