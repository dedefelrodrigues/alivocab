import type { StatsDto } from '@alivocab/shared';
import { useId, useState } from 'react';
import { cn } from '@/lib/utils';

type Day = StatsDto['daily'][number];

const dateLabel = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, opts);

/** Clean axis maximum (1, 2, 5, 10, 20, 50 …) at or above `max`, and its ticks. */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const steps = [1, 2, 5];
  let unit = 1;
  for (;;) {
    for (const s of steps) {
      const step = s * unit;
      if (step * 4 >= max) {
        const top = Math.ceil(max / step) * step;
        return Array.from({ length: top / step + 1 }, (_, i) => i * step);
      }
    }
    unit *= 10;
  }
}

/**
 * Reviews per day as columns (one series, drawn in `primary`). Each column is a hover/focus
 * target with a tooltip; the same numbers are available as a table.
 */
export function ReviewsChart({ days }: { days: Day[] }) {
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();
  const max = Math.max(...days.map((d) => d.reviews));
  const ticks = niceTicks(max);
  const top = ticks.at(-1) || 1;
  const labelEvery = days.length > 45 ? 14 : days.length > 14 ? 7 : 1;
  const shown = active !== null ? days[active] : null;

  return (
    <figure className="space-y-2">
      <div className="relative">
        {/* Y axis ticks and hairline grid */}
        <div className="pointer-events-none absolute inset-0 bottom-6 left-0" aria-hidden>
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute right-0 left-8 border-t border-border"
              style={{ bottom: `${(t / top) * 100}%` }}
            >
              <span className="absolute -top-2 -left-8 w-6 text-right text-[10px] text-muted-foreground tabular-nums">
                {t}
              </span>
            </div>
          ))}
        </div>
        <ol
          className="relative ml-8 flex h-44 items-end gap-0.5 pb-6"
          aria-label="Reviews per day"
          aria-describedby={tableId}
        >
          {days.map((d, i) => {
            const height = (d.reviews / top) * 100;
            return (
              <li key={d.date} className="relative flex h-full flex-1 justify-center">
                <button
                  type="button"
                  className="flex h-full w-full items-end justify-center rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive((a) => (a === i ? null : a))}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive((a) => (a === i ? null : a))}
                  aria-label={`${dateLabel(d.date, { weekday: 'long', month: 'long', day: 'numeric' })}: ${d.reviews} reviews, ${d.correct} right`}
                >
                  <span
                    className={cn(
                      'block w-full max-w-6 rounded-t-[4px] bg-primary transition-opacity',
                      active !== null && active !== i && 'opacity-60',
                    )}
                    style={{ height: d.reviews ? `max(${height}%, 2px)` : 0 }}
                  />
                </button>
                {i % labelEvery === labelEvery - 1 || i === days.length - 1 ? (
                  <span
                    className="absolute -bottom-0.5 text-[10px] whitespace-nowrap text-muted-foreground"
                    aria-hidden
                  >
                    {i === days.length - 1
                      ? 'Today'
                      : dateLabel(d.date, { month: 'short', day: 'numeric' })}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        {shown && active !== null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-0 z-10 min-w-36 -translate-x-1/2 rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
            style={{
              left: `calc(2rem + (100% - 2rem) * ${(active + 0.5) / days.length})`,
            }}
          >
            <p className="text-xs text-muted-foreground">
              {dateLabel(shown.date, { weekday: 'short', month: 'short', day: 'numeric' })}
            </p>
            <p>
              <strong className="tabular-nums">{shown.reviews}</strong> reviews
            </p>
            {shown.reviews > 0 && (
              <p className="text-xs text-muted-foreground">
                {Math.round((shown.correct / shown.reviews) * 100)}% right
                {shown.newWords ? ` · ${shown.newWords} new` : ''}
              </p>
            )}
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">Show as a table</summary>
        <table id={tableId} className="mt-2 w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Reviews</th>
              <th className="py-1 text-right font-medium">Right</th>
              <th className="py-1 text-right font-medium">New words</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {days
              .filter((d) => d.reviews > 0)
              .map((d) => (
                <tr key={d.date} className="border-t">
                  <td className="py-1">
                    {dateLabel(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </td>
                  <td className="py-1 text-right">{d.reviews}</td>
                  <td className="py-1 text-right">{d.correct}</td>
                  <td className="py-1 text-right">{d.newWords}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
