import type { LogCategory, LogEntryDto, LogLevel } from '@alivocab/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CircleX, Copy, Info, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { logsQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

const LEVELS = [
  { id: 'all', label: 'Everything' },
  { id: 'problems', label: 'Problems only' },
] as const;

const CATEGORIES = [
  { id: undefined, label: 'All sources' },
  { id: 'request', label: 'Requests' },
  { id: 'ai', label: 'AI calls' },
  { id: 'app', label: 'App' },
] as const;

const CATEGORY_LABEL: Record<LogCategory, string> = {
  request: 'Request',
  ai: 'AI',
  app: 'App',
};

const LEVEL_STYLE: Record<LogLevel, { icon: typeof Info; label: string; className: string }> = {
  info: { icon: Info, label: 'Info', className: 'text-muted-foreground' },
  warn: { icon: TriangleAlert, label: 'Warning', className: 'text-status-recognize' },
  error: { icon: CircleX, label: 'Error', className: 'text-incorrect' },
};

export const Route = createFileRoute('/_app/log')({
  validateSearch: z.object({
    level: z.enum(['all', 'problems']).optional(),
    category: z.enum(['request', 'ai', 'app']).optional(),
  }),
  component: LogPage,
});

function Segmented<T extends string | undefined>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="m-0 inline-flex flex-wrap rounded-lg border p-0.5">
      <legend className="sr-only">{legend}</legend>
      {options.map((o) => (
        <label
          key={o.label}
          className={cn(
            'cursor-pointer rounded-md px-2.5 py-1 text-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
            o.id === value
              ? 'bg-secondary font-medium text-secondary-foreground'
              : 'text-muted-foreground hover:bg-accent',
          )}
        >
          <input
            type="radio"
            className="sr-only"
            checked={o.id === value}
            onChange={() => onChange(o.id)}
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

function LogPage() {
  const { level = 'all', category } = Route.useSearch();
  const navigate = Route.useNavigate();
  const query = useInfiniteQuery({ ...logsQuery({ level, category }), refetchInterval: 10_000 });
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? [];
  const recordingAll = query.data?.pages[0]?.recordingAll;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Activity log</h1>
        <p className="text-sm text-muted-foreground">
          {recordingAll === false ? (
            <>
              Only problems and AI calls are recorded now. To see every request, turn on{' '}
              <Link to="/settings" hash="advanced" className="underline">
                advanced mode
              </Link>
              .
            </>
          ) : (
            'Every request, AI call and problem in the app, newest first. Kept for 14 days.'
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          legend="Show"
          options={LEVELS}
          value={level}
          onChange={(v) => void navigate({ search: (s) => ({ ...s, level: v }), replace: true })}
        />
        <Segmented
          legend="Source"
          options={CATEGORIES}
          value={category}
          onChange={(v) => void navigate({ search: (s) => ({ ...s, category: v }), replace: true })}
        />
        <span className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw className={cn(query.isFetching && 'animate-spin')} /> Refresh
        </Button>
      </div>

      {query.isPending ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : query.error ? (
        <p className="text-incorrect">Could not load the log: {errorMessage(query.error)}</p>
      ) : entries.length === 0 ? (
        <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
          Nothing recorded {level === 'problems' ? 'that went wrong' : 'yet'}.
        </p>
      ) : (
        <ol className="divide-y rounded-xl border">
          {entries.map((e) => (
            <LogRow key={e.id} entry={e} />
          ))}
        </ol>
      )}

      {query.hasNextPage && (
        <Button
          variant="outline"
          className="w-full"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage && <Loader2 className="animate-spin" />} Load older
        </Button>
      )}
    </div>
  );
}

function formatTime(iso: string) {
  const at = new Date(iso);
  const time = at.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return at.toDateString() === new Date().toDateString()
    ? time
    : `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}

function LogRow({ entry }: { entry: LogEntryDto }) {
  const style = LEVEL_STYLE[entry.level];
  const Icon = style.icon;
  const details = Object.entries(entry.details ?? {}).filter(([, v]) => v != null && v !== '');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
      toast.success('Copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2.5 outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
          <Icon
            className={cn('mt-0.5 size-4 shrink-0', style.className)}
            aria-label={style.label}
          />
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm group-open:font-medium">
              {entry.message}
            </span>
            <span className="block text-xs text-muted-foreground tabular-nums">
              {formatTime(entry.at)} · {CATEGORY_LABEL[entry.category]}
              {entry.status != null && ` · ${entry.status}`}
              {entry.durationMs != null && ` · ${entry.durationMs} ms`}
            </span>
          </span>
        </summary>
        <div className="space-y-2 px-3 pb-3 pl-9">
          {details.length > 0 ? (
            <dl className="space-y-2 text-sm">
              {details.map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs font-medium text-muted-foreground">{key}</dt>
                  <dd>
                    <pre className="max-h-72 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs whitespace-pre-wrap break-words">
                      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
                    </pre>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">No details.</p>
          )}
          <Button variant="ghost" size="sm" onClick={() => void copy()}>
            <Copy /> Copy entry
          </Button>
        </div>
      </details>
    </li>
  );
}
