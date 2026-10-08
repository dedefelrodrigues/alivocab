import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Flame, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { reviewSummaryQuery } from '@/lib/queries';

const weekday = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' });

export function ReviewSummaryCard() {
  const { data, isPending } = useQuery(reviewSummaryQuery);
  if (isPending) return <Skeleton className="h-40 w-full" />;
  if (!data) return null;

  const total = data.dueNow + data.newAvailable;
  const max = Math.max(1, ...data.forecast.map((d) => d.count));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Layers className="size-5 text-primary" /> Today
          </CardTitle>
          <CardDescription>
            {total
              ? `${data.dueNow} review${data.dueNow === 1 ? '' : 's'} due · ${data.newAvailable} new`
              : data.reviewedToday
                ? `All done for now: ${data.reviewedToday} reviewed today.`
                : 'Nothing due. Add words to a theme to start.'}
          </CardDescription>
        </div>
        {data.streakDays > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-sm font-medium text-secondary-foreground">
            <Flame className="size-4 text-primary" aria-hidden />
            {data.streakDays} day{data.streakDays === 1 ? '' : 's'}
            <span className="sr-only"> streak</span>
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {total > 0 && (
          <Button asChild className="h-11 w-full text-base">
            <Link to="/review">Start reviewing ({total})</Link>
          </Button>
        )}
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">Next 7 days</p>
          <ol
            className="grid h-16 grid-cols-7 items-end gap-1.5"
            aria-label="Reviews due in the next 7 days"
          >
            {data.forecast.map((d, i) => (
              <li key={d.date} className="flex h-full flex-col items-center justify-end gap-1">
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {d.count || ''}
                </span>
                <span
                  className={
                    i === 0 ? 'w-full rounded-sm bg-primary' : 'w-full rounded-sm bg-chart-2/70'
                  }
                  style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }}
                  aria-hidden
                />
                <span className="text-[10px] text-muted-foreground" aria-hidden>
                  {i === 0 ? '•' : weekday(d.date)}
                </span>
                <span className="sr-only">
                  {i === 0
                    ? 'Today'
                    : new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, {
                        weekday: 'long',
                      })}
                  : {d.count}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
