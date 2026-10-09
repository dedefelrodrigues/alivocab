import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ReviewsChart } from '@/features/stats/ReviewsChart';
import { WordsTable } from '@/features/stats/WordsTable';
import { StatusBar } from '@/features/themes/status';
import { errorMessage } from '@/lib/api';
import { statsQuery, themesQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

const PERIODS = [7, 30, 90] as const;

export const Route = createFileRoute('/_app/stats')({
  validateSearch: z.object({
    themeId: z.string().optional(),
    days: z.coerce
      .number()
      .pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]))
      .optional(),
  }),
  component: StatsPage,
});

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

const percent = (r: { correct: number; total: number }) =>
  r.total ? `${Math.round((r.correct / r.total) * 100)}%` : '–';

function duration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function StatsPage() {
  const { themeId, days = 30 } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: themes } = useQuery(themesQuery);
  const { data, isPending, isFetching, error } = useQuery(statsQuery(themeId, days));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Stats</h1>

      {/* Filters scope everything below. */}
      <div className="flex flex-wrap items-center gap-2">
        <fieldset className="m-0 inline-flex rounded-lg border p-0.5">
          <legend className="sr-only">Period</legend>
          {PERIODS.map((p) => (
            <label
              key={p}
              className={cn(
                'cursor-pointer rounded-md px-3 py-1.5 text-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                p === days
                  ? 'bg-secondary font-medium text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              <input
                type="radio"
                name="period"
                className="sr-only"
                checked={p === days}
                onChange={() => void navigate({ search: (s) => ({ ...s, days: p }) })}
              />
              {p} days
            </label>
          ))}
        </fieldset>
        <select
          aria-label="Theme"
          value={themeId ?? ''}
          onChange={(e) =>
            void navigate({ search: (s) => ({ ...s, themeId: e.target.value || undefined }) })
          }
          className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">All themes</option>
          {themes?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : error || !data ? (
        <p className="text-incorrect">Could not load your stats: {errorMessage(error)}</p>
      ) : (
        <div className={cn('space-y-6 transition-opacity', isFetching && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile
              label="Streak"
              value={`${data.streakDays} day${data.streakDays === 1 ? '' : 's'}`}
            />
            <Tile
              label="Remembered"
              value={percent(data.retention.all)}
              detail={
                data.retention.mature.total
                  ? `${percent(data.retention.mature)} on well-known words`
                  : `of ${data.retention.all.total} reviews`
              }
            />
            <Tile
              label="Reviews"
              value={data.daily.reduce((n, d) => n + d.reviews, 0).toLocaleString()}
              detail={`in ${days} days`}
            />
            <Tile
              label="Time practicing"
              value={duration(data.timeMs)}
              detail={`in ${days} days`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Reviews per day</CardTitle>
              <CardDescription>
                Flashcards and lessons, last {days} days. Hover or focus a day for details.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ReviewsChart days={data.daily} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your words</CardTitle>
              <CardDescription>
                {data.totals.words.toLocaleString()} words · seen{' '}
                {data.totals.exposures.toLocaleString()} times ·{' '}
                {data.totals.reviews.toLocaleString()} reviews in total
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <StatusBar counts={data.status} />
              <WordsTable words={data.words} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
